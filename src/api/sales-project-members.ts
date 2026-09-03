import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ItemRepository } from "@/domain/item";
import { createCloudShareProjectMemberSource, type CloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";
import { projectCloudShareFailureContext, projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";

export interface SalesProjectMembersDeps {
  readonly items: Pick<ItemRepository, "findById">;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly sourceFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): CloudShareProjectMemberSource };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
}

export interface SalesProjectMembersRequest {
  readonly customerId: string;
  readonly actor: DiagnosticActor;
  readonly itemId: string;
}

/** API-first read for the ephemeral Sales Pro selector. No result is cached. */
export async function handleListSalesProjectMembers(deps: SalesProjectMembersDeps, request: SalesProjectMembersRequest) {
  const [item, connection] = await Promise.all([
    deps.items.findById(request.itemId), deps.connections.findByCustomerId(request.customerId),
  ]);
  const correlationId = randomUUID();
  if (!item || item.customerId !== request.customerId || item.status !== "active") {
    return rejected(deps, request, correlationId, 404, "Active Item was not found for this Customer.", "item_not_found_or_inactive");
  }
  if (!connection) return rejected(deps, request, correlationId, 404, "Save a Certalis CloudShare Connection before selecting a Sales Pro.", "connection_missing");

  try {
    const source = deps.sourceFactory?.forConnection(connection) ?? createCloudShareProjectMemberSource((deps.cloudshare ?? missingClientFactory).forConnection(connection, { scope: "customer_default", reason: "catalogue_resource_read" }));
    const read = await source.listActiveProjectMembers(item.project.id);
    await deps.diagnostics?.record({ source: "sales-project-members", operation: "sales.enablement_session.project_members.read", outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, correlationId, message: "Active Project members read for Sales Pro selection", externalIds: { itemId: item.id, projectId: item.project.id }, request: read.request as unknown as Record<string, unknown>, response: read.response as unknown as Record<string, unknown>, details: { integrationSurface: read.integrationSurface, memberCount: read.members.length, ephemeral: true, cached: false } });
    await deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.enablement_session.project_members.read", subjectType: "item", subjectId: item.id, outcome: "success", correlationId, details: { projectId: item.project.id, memberCount: read.members.length, cached: false } });
    return { status: 200, body: { members: read.members } };
  } catch (error) {
    const evidence = cloudShareEvidence(error);
    const context = cloudShareFailureContext(error);
    const oauthFailure = evidence?.request === null && evidence.response === null;
    const status = typeof context?.responseStatus === "number" ? context.responseStatus : typeof context?.status === "number" ? context.status : undefined;
    await deps.diagnostics?.record({ source: "sales-project-members", operation: "sales.enablement_session.project_members.read", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, correlationId, message: "CloudShare could not read active Project members for Sales Pro selection", externalIds: { itemId: item.id, projectId: item.project.id }, request: evidence?.request, response: evidence?.response, details: { integrationSurface: typeof context?.integrationSurface === "string" ? context.integrationSurface : "cloudshare.v3.project_members_gui", failureMode: oauthFailure ? status === undefined ? "transport_failure" : "http_failure" : "project_member_read", ...(oauthFailure && status !== undefined ? { status } : {}), ephemeral: true, cached: false, error: error instanceof Error ? error.message : String(error) } });
    await deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.enablement_session.project_members.read", subjectType: "item", subjectId: item.id, outcome: "failure", correlationId, details: { projectId: item.project.id, cached: false }, error: error instanceof Error ? error.message : String(error) });
    return { status: 502, body: { error: "CloudShare could not retrieve active Project members. Review support diagnostics before retrying.", correlationId } };
  }
}

async function rejected(deps: SalesProjectMembersDeps, request: SalesProjectMembersRequest, correlationId: string, status: number, error: string, failureMode: string) {
  await deps.diagnostics?.record({ source: "sales-project-members", operation: "sales.enablement_session.project_members.read", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, correlationId, message: error, externalIds: { itemId: request.itemId }, request: { method: "GET", path: "/api/sales/enablement-sessions/project-members" }, response: { status }, details: { integrationSurface: "portal.sales_enablement_sessions", failureMode, cached: false } });
  return { status, body: { error, correlationId } };
}

const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = { forConnection() { throw new Error("CloudShare Project members are not configured."); } };

function cloudShareEvidence(error: unknown): { request: Record<string, unknown> | null; response: Record<string, unknown> | null } | undefined {
  const projected = projectCloudShareFailureEvidence(error);
  if (projected) return projected;
  const context = cloudShareFailureContext(error);
  return projectCloudShareFailureContext(context);
}

function cloudShareFailureContext(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  return (error as { context?: Record<string, unknown> }).context;
}
