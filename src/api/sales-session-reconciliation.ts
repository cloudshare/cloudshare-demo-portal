import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";

export async function handleReconcileSalesSession(deps: { sessions: Pick<SalesDemoSessionRepository, "findById" | "updateOperationalState">; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare?: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): SalesDelivery }; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write"> }, request: { customerId: string; sessionId: string; actor: DiagnosticActor }) {
  if (!deps.sessions.findById || !deps.sessions.updateOperationalState) return { status: 503, body: { error: "Sales reconciliation is unavailable." } };
  const [session, connection] = await Promise.all([deps.sessions.findById(request.customerId, request.sessionId), deps.connections.findByCustomerId(request.customerId)]);
  if (!session || !connection) return { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } };
  if (session.operationalStatus !== "active" || session.cloudShareSalesExperienceId.startsWith("pending:")) return { status: 409, body: { error: "Only active Sales Sessions with a provisioned CloudShare Experience can be reconciled." } };
  const correlationId = randomUUID();
  try {
    const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery((deps.cloudshare as NonNullable<typeof deps.cloudshare>).forConnection(connection));
    const remote = await delivery.readSession(session.cloudShareSalesExperienceId);
    await deps.sessions.updateOperationalState(session.id, { operationalStatus: "active", attentionReason: null });
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-session-reconciliation", operation: "sales.demo_session.reconciled", outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, message: "Sales Session reconciled with CloudShare", correlationId, request: remote.request as unknown as Record<string, unknown>, response: remote.response as unknown as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales", remoteStatus: remote.status } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.reconciled", subjectType: "sales_demo_session", subjectId: session.id, outcome: "success", correlationId, details: { integrationSurface: "cloudshare.v4.sales", remoteStatus: remote.status, cloudShareSalesExperienceId: session.cloudShareSalesExperienceId } }),
    ]);
    return { status: 200, body: { correlationId, operationalStatus: "active" } };
  } catch (error) {
    await deps.sessions.updateOperationalState(session.id, { operationalStatus: "needs_attention", attentionReason: "CloudShare reconciliation failed" });
    const exchange = cloudShareExchange(error);
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-session-reconciliation", operation: "sales.demo_session.reconciled", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, message: "CloudShare Sales Session reconciliation failed", correlationId, request: exchange?.request, response: exchange?.response, details: { integrationSurface: "cloudshare.v4.sales", failureMode: "sales_read", error: error instanceof Error ? error.message : String(error) } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.reconciled", subjectType: "sales_demo_session", subjectId: session.id, outcome: "failure", correlationId, details: { integrationSurface: "cloudshare.v4.sales", failureMode: "sales_read", cloudShareSalesExperienceId: session.cloudShareSalesExperienceId }, error: error instanceof Error ? error.message : String(error) }),
    ]);
    return { status: 502, body: { error: "CloudShare could not reconcile this Sales Session.", correlationId } };
  }
}

function cloudShareExchange(error: unknown): { request?: Record<string, unknown>; response?: Record<string, unknown> } | undefined {
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  const context = (error as { context?: Record<string, unknown> }).context;
  return context ? { request: { method: context.method, path: context.path, headers: context.requestHeaders, query: context.requestQuery }, response: { status: context.responseStatus ?? context.status, headers: context.responseHeaders, body: context.responseBody, transport: context.cause } } : undefined;
}
