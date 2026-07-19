import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { isSalesSessionVerificationEligible } from "@/domain/sales-session-verification";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import type { CloudShareSalesExperienceStatus } from "@/domain/sales-session-status";

export async function handleReconcileSalesSession(deps: { sessions: Pick<SalesDemoSessionRepository, "findById" | "updateOperationalState">; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare?: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "readSession"> }; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write"> }, request: { customerId: string; sessionId: string; actor: DiagnosticActor }) {
  if (!deps.sessions.findById || !deps.sessions.updateOperationalState) return { status: 503, body: { error: "Sales reconciliation is unavailable." } };
  const [session, connection] = await Promise.all([deps.sessions.findById(request.customerId, request.sessionId), deps.connections.findByCustomerId(request.customerId)]);
  if (!session || !connection) return { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } };
  if (!isSalesSessionVerificationEligible(session)) return { status: 409, body: { error: "Only active Sales Sessions with a provisioned CloudShare Experience can be reconciled." } };
  const correlationId = randomUUID();
  let remote: Awaited<ReturnType<SalesDelivery["readSession"]>> | undefined;
  try {
    const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery((deps.cloudshare as NonNullable<typeof deps.cloudshare>).forConnection(connection));
    remote = await delivery.readSession(session.cloudShareSalesExperienceId);
    const providerStatus = asCloudShareSalesExperienceStatus(remote.status);
    await deps.sessions.updateOperationalState(session.id, { operationalStatus: "active", attentionReason: null, ...(providerStatus ? { experienceStatus: providerStatus, experienceStatusObservedAt: new Date() } : {}) });
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-session-reconciliation", operation: "sales.demo_session.reconciled", outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, message: "Sales Session reconciled with CloudShare", correlationId, request: remote.request as unknown as Record<string, unknown>, response: remote.response as unknown as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales", remoteStatus: remote.status } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.reconciled", subjectType: "sales_demo_session", subjectId: session.id, outcome: "success", correlationId, details: { integrationSurface: "cloudshare.v4.sales", remoteStatus: remote.status, cloudShareSalesExperienceId: session.cloudShareSalesExperienceId } }),
    ]);
    return { status: 200, body: { correlationId, operationalStatus: "active" } };
  } catch (error) {
    const localPersistenceFailure = remote !== undefined;
    await Promise.allSettled([deps.sessions.updateOperationalState(session.id, { operationalStatus: "needs_attention", attentionReason: localPersistenceFailure ? "CloudShare read succeeded but Certalis could not persist reconciliation" : "CloudShare reconciliation failed" })]);
    const exchange = remote ? { request: remote.request as unknown as Record<string, unknown>, response: remote.response as unknown as Record<string, unknown> } : cloudShareExchange(error);
    const failureMode = localPersistenceFailure ? "local_reconciliation_persistence" : "sales_read";
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-session-reconciliation", operation: "sales.demo_session.reconciled", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, message: localPersistenceFailure ? "CloudShare Sales Session was read but Certalis could not persist reconciliation" : "CloudShare Sales Session reconciliation failed", correlationId, request: exchange?.request, response: exchange?.response, details: { integrationSurface: "cloudshare.v4.sales", failureMode, error: error instanceof Error ? error.message : String(error) } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.reconciled", subjectType: "sales_demo_session", subjectId: session.id, outcome: "failure", correlationId, details: { integrationSurface: "cloudshare.v4.sales", failureMode, cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, error: error instanceof Error ? error.message : String(error) }),
    ]);
    return { status: 502, body: { error: localPersistenceFailure ? "CloudShare was read, but Certalis could not persist reconciliation. Review support diagnostics." : "CloudShare could not reconcile this Sales Session.", correlationId } };
  }
}

function asCloudShareSalesExperienceStatus(value: string | undefined): CloudShareSalesExperienceStatus | null {
  return value === "notStarted" || value === "inProgress" || value === "ended" ? value : null;
}

function cloudShareExchange(error: unknown): { request?: Record<string, unknown>; response?: Record<string, unknown> } | undefined {
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  const context = (error as { context?: Record<string, unknown> }).context;
  return context ? { request: { method: context.method, path: context.path, headers: context.requestHeaders, query: context.requestQuery }, response: { status: context.responseStatus ?? context.status, headers: context.responseHeaders, body: context.responseBody, transport: context.cause } } : undefined;
}
