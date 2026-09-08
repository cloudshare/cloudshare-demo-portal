import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { isSalesSessionVerificationEligible } from "@/domain/sales-session-verification";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { CloudShareResponseError } from "@/integrations/cloudshare/errors";
import { projectCloudShareFailureContext, projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";

export async function handleReconcileSalesSession(deps: { sessions: Pick<SalesDemoSessionRepository, "findById" | "updateOperationalState">; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare?: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "readSession"> }; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write"> }, request: { customerId: string; sessionId: string; actor: DiagnosticActor }) {
  if (!deps.sessions.findById || !deps.sessions.updateOperationalState) return { status: 503, body: { error: "Sales reconciliation is unavailable." } };
  const [session, connection] = await Promise.all([deps.sessions.findById(request.customerId, request.sessionId), deps.connections.findByCustomerId(request.customerId)]);
  if (!session || !connection) return { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } };
  if (!isSalesSessionVerificationEligible(session)) return { status: 409, body: { error: "Only active Sales Sessions with a provisioned CloudShare Experience can be reconciled." } };
  const correlationId = randomUUID();
  let remote: Awaited<ReturnType<SalesDelivery["readSession"]>> | undefined;
  try {
    const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery((deps.cloudshare as NonNullable<typeof deps.cloudshare>).forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" }));
    const read = await delivery.readSession(session.cloudShareSalesExperienceId);
    if (read.status !== "notStarted" && read.status !== "inProgress" && read.status !== "ended") throw salesStatusContractError(read);
    remote = read;
    const observedAt = new Date();
    await deps.sessions.updateOperationalState(request.customerId, session.id, { operationalStatus: "active", attentionReason: null, experienceStatus: read.status, experienceStatusObservedAt: observedAt });
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-session-reconciliation", operation: "sales.demo_session.reconciled", outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, message: "Sales Session reconciled with CloudShare", correlationId, request: remote.request as unknown as Record<string, unknown>, response: remote.response as unknown as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales", remoteStatus: remote.status } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.reconciled", subjectType: "sales_demo_session", subjectId: session.id, outcome: "success", correlationId, details: { integrationSurface: "cloudshare.v4.sales", remoteStatus: remote.status, cloudShareSalesExperienceId: session.cloudShareSalesExperienceId } }),
    ]);
    return { status: 200, body: { correlationId, operationalStatus: "active", experienceStatus: remote.status, observedAt: observedAt.toISOString(), freshness: "fresh", source: "cloudshare_v4_get_sales" } };
  } catch (error) {
    const localPersistenceFailure = remote !== undefined;
    await Promise.allSettled([deps.sessions.updateOperationalState(request.customerId, session.id, { operationalStatus: "needs_attention", attentionReason: localPersistenceFailure ? "CloudShare read succeeded but Certalis could not persist reconciliation" : "CloudShare reconciliation failed" })]);
    const exchange = remote ? { request: remote.request as unknown as Record<string, unknown>, response: remote.response as unknown as Record<string, unknown> } : cloudShareExchange(error);
    const failureMode = localPersistenceFailure ? "local_reconciliation_persistence" : failureModeFrom(error);
    const failureContext = cloudShareFailureContext(error);
    const integrationSurface = !localPersistenceFailure && typeof failureContext?.integrationSurface === "string" ? failureContext.integrationSurface : "cloudshare.v4.sales";
    const oauthFailure = exchange?.request === null && exchange.response === null;
    const status = typeof failureContext?.responseStatus === "number" ? failureContext.responseStatus : typeof failureContext?.status === "number" ? failureContext.status : undefined;
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-session-reconciliation", operation: "sales.demo_session.reconciled", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, message: localPersistenceFailure ? "CloudShare Sales Session was read but Certalis could not persist reconciliation" : "CloudShare Sales Session reconciliation failed", correlationId, request: exchange?.request, response: exchange?.response, details: { integrationSurface, failureMode, ...(oauthFailure && status !== undefined ? { status } : {}), error: error instanceof Error ? error.message : String(error) } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.reconciled", subjectType: "sales_demo_session", subjectId: session.id, outcome: "failure", correlationId, details: { integrationSurface, failureMode, cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, error: error instanceof Error ? error.message : String(error) }),
    ]);
    return { status: 502, body: { error: localPersistenceFailure ? "CloudShare was read, but Certalis could not persist reconciliation. Review support diagnostics." : "CloudShare could not reconcile this Sales Session.", correlationId } };
  }
}

function failureModeFrom(error: unknown): string {
  if (error instanceof Error && "context" in error) {
    const failureMode = (error as { context?: { failureMode?: unknown } }).context?.failureMode;
    if (typeof failureMode === "string") return failureMode;
  }
  return "sales_read";
}

function salesStatusContractError(remote: { readonly status: unknown; readonly request: { readonly method?: unknown; readonly path?: unknown }; readonly response: { readonly status?: unknown; readonly body?: unknown } }): CloudShareResponseError {
  return new CloudShareResponseError("CloudShare returned an unsupported Sales Experience status.", { method: typeof remote.request.method === "string" ? remote.request.method : "GET", path: typeof remote.request.path === "string" ? remote.request.path : "/sales", status: typeof remote.response.status === "number" ? remote.response.status : 200, responseStatus: typeof remote.response.status === "number" ? remote.response.status : 200, responseBody: remote.response.body, failureMode: "sales_status_contract", remoteStatus: remote.status });
}

function cloudShareExchange(error: unknown): { request: Record<string, unknown> | null; response: Record<string, unknown> | null } | undefined {
  const projected = projectCloudShareFailureEvidence(error);
  if (projected) return projected;
  const context = cloudShareFailureContext(error);
  return projectCloudShareFailureContext(context);
}

function cloudShareFailureContext(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  return (error as { context?: Record<string, unknown> }).context;
}
