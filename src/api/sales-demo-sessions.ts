import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ItemRepository, SalesExperienceType } from "@/domain/item";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";
import { isValidCloudShareWallClock } from "@/domain/cloudshare-wall-clock";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { SalesItemProvisioningValidationError, type SalesItemProvisioningValidator } from "@/integrations/cloudshare/sales-item-provisioning";

const bodySchema = z.object({
  opportunityId: z.string().trim().min(1), itemId: z.string().trim().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Start must be ISO local date-time."),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "End must be ISO local date-time."),
  timeZone: z.string().trim().min(1).max(100), type: z.enum(["demo", "poc", "pov", "trial"]).optional(),
});
type SessionBody = z.infer<typeof bodySchema>;
const response = (status: number, body: Record<string, unknown>) => ({ status, body });

export interface SalesDemoSessionDeps {
  readonly records: Pick<SalesRecordRepository, "findOpportunity">;
  readonly items: Pick<ItemRepository, "findById">;
  readonly sessions: SalesDemoSessionRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): SalesDelivery };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly itemProvisioningValidator?: SalesItemProvisioningValidator;
  readonly itemProvisioningValidatorFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): SalesItemProvisioningValidator };
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly now?: () => Date;
  readonly newId?: () => string;
}
export interface SalesDemoSessionRequest { readonly customerId: string; readonly actor: DiagnosticActor; readonly body?: unknown; }

/** API-first orchestration for a single Customer-scoped Sales Demo Session.
 * The handler owns portal lifecycle and audit records; the deep Delivery module
 * owns all CloudShare protocol details. It intentionally does not enroll or
 * invite participants (those are follow-on slices). */
export async function handleCreateSalesDemoSession(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest) {
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) return rejected(deps, request, 400, "Invalid Sales Demo Session request.", "invalid_request");
  if (!isChronological(parsed.data)) return rejected(deps, request, 400, "End must be after start.", "end_before_start");
  if (!isValidCloudShareWallClock(parsed.data.start, parsed.data.timeZone) || !isValidCloudShareWallClock(parsed.data.end, parsed.data.timeZone)) return rejected(deps, request, 400, "Start and end must be unambiguous CloudShare wall-clock values in the selected time zone.", "invalid_wall_clock");
  const [opportunity, item, connection] = await Promise.all([
    deps.records.findOpportunity(request.customerId, parsed.data.opportunityId), deps.items.findById(parsed.data.itemId), deps.connections.findByCustomerId(request.customerId),
  ]);
  if (!opportunity || opportunity.customerId !== request.customerId) return rejected(deps, request, 404, "Opportunity was not found for this Customer.", "opportunity_not_found");
  if (opportunity.archivedAt) return rejected(deps, request, 409, "Archived Opportunities cannot receive new Sales Demo Sessions.", "opportunity_archived", { opportunityId: opportunity.id });
  if (!item || item.customerId !== request.customerId || item.status !== "active") return rejected(deps, request, 404, "Active Item was not found for this Customer.", "item_not_found_or_inactive", { itemId: parsed.data.itemId });
  if (!connection) return rejected(deps, request, 404, "Save a Certalis CloudShare Connection before provisioning a Sales Demo Session.", "connection_missing");

  const id = (deps.newId ?? randomUUID)();
  // This deliberately identifies the commercial Opportunity rather than this
  // mutable UI submission: every replacement Sales Experience stays correlated
  // to the same immutable Certalis Opportunity key for future CRM mapping.
  const externalId = `certalis:opp:${opportunity.id}`;
  const correlationId = randomUUID();
  const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection));
  try {
    const validator = deps.itemProvisioningValidator ?? deps.itemProvisioningValidatorFactory?.forConnection(connection);
    const resourceReads = validator ? await validator.revalidate(item) : [];
    await recordResourceReads(deps, request, correlationId, item.id, item.project.id, resourceReads, "success");
    const created = await delivery.createSession(toDeliveryInput(parsed.data, item, opportunity.name, externalId, request.actor.email ?? ""));
    const now = (deps.now ?? (() => new Date()))();
    const session: SalesDemoSession = { id, customerId: request.customerId, opportunityId: opportunity.id, itemId: item.id, cloudShareSalesExperienceId: created.salesExperienceId, externalId, type: parsed.data.type ?? item.salesExperienceType, start: parsed.data.start, end: parsed.data.end, timeZone: parsed.data.timeZone, registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: now };
    // Deliberate partial-failure behaviour: the external Experience is retained
    // when local persistence fails; support evidence identifies its immutable ID.
    try { await deps.sessions.save(session); } catch (error) {
      // Neither evidence store may erase the already-created remote ID from the
      // response: the admin must be told not to retry even during a secondary
      // observability outage.
      await Promise.allSettled([
        evidence(deps, request, correlationId, session, "failure", "CloudShare Sales Experience was created but Certalis could not persist its correlation", created, { integrationSurface: "cloudshare.v4.sales", failureMode: "local_correlation_persistence", createdSalesExperienceId: created.salesExperienceId, error: error instanceof Error ? error.message : String(error) }),
        deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "failure", correlationId, details: { cloudShareSalesExperienceId: created.salesExperienceId, opportunityId: opportunity.id, itemId: item.id, externalId, needsAttention: true }, error: error instanceof Error ? error.message : "Local correlation persistence failed" }),
      ]);
      return response(503, { error: "CloudShare created the Sales Experience, but Certalis could not save its correlation. Do not retry creation; review support diagnostics.", correlationId, needsAttention: true, cloudShareSalesExperienceId: created.salesExperienceId });
    }
    await evidence(deps, request, correlationId, session, "success", "Sales Demo Session created", created, { integrationSurface: "cloudshare.v4.sales", registrationType: session.registrationType, sendInvitations: session.sendInvitations });
    await deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "success", correlationId, details: { cloudShareSalesExperienceId: created.salesExperienceId, opportunityId: opportunity.id, itemId: item.id, externalId } });
    return response(201, { session });
  } catch (error) {
    const validationFailure = isMainSalesProValidationFailure(error);
    if (error instanceof SalesItemProvisioningValidationError) {
      await recordResourceReads(deps, request, correlationId, item.id, item.project.id, error.completedReads, "failure");
    }
    const causeEvidence = cloudShareEvidence(error);
    const itemValidationFailure = error instanceof SalesItemProvisioningValidationError;
    await evidence(deps, request, correlationId, { id, customerId: request.customerId, opportunityId: opportunity.id, itemId: item.id, cloudShareSalesExperienceId: "unprovisioned", externalId, type: parsed.data.type ?? item.salesExperienceType, start: parsed.data.start, end: parsed.data.end, timeZone: parsed.data.timeZone, registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: new Date() }, "failure", validationFailure ? "CloudShare main Sales Pro validation failed" : itemValidationFailure ? "Sales Demo Item is stale against CloudShare resources" : "CloudShare Sales Experience creation failed", causeEvidence, { integrationSurface: itemValidationFailure ? "cloudshare.v3.sales_item_resources" : "cloudshare.v4.sales", failureMode: validationFailure ? "main_sales_pro_validation" : itemValidationFailure ? "item_resource_drift" : "cloudshare_create", error: error instanceof Error ? error.message : String(error) });
    await deps.audit?.write({ id: randomUUID(), occurredAt: (deps.now ?? (() => new Date()))(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "failure", correlationId, details: { externalId, opportunityId: opportunity.id, itemId: item.id }, error: error instanceof Error ? error.message : "Unknown CloudShare failure" });
    return response(validationFailure || itemValidationFailure ? 422 : 502, { error: validationFailure ? "The authenticated Sales Admin is not configured as the CloudShare main Sales Pro. Review support diagnostics." : itemValidationFailure ? "This Demo Item no longer matches its CloudShare resources. Refresh the Item before provisioning." : "CloudShare could not create the Sales Experience. Review support diagnostics.", correlationId });
  }
}

function toDeliveryInput(input: SessionBody, item: { name: string; project: { id: string }; blueprints: readonly { id: string }[]; policy: { id: string }; regions: readonly { id: string }[]; salesExperienceType: SalesExperienceType }, opportunity: string, externalId: string, mainSalesProEmail: string) {
  return { name: `${item.name} — ${opportunity}`.slice(0, 100), type: input.type ?? item.salesExperienceType, projectId: item.project.id, blueprintIds: item.blueprints.map((blueprint) => blueprint.id), regionIds: item.regions.map((region) => region.id), policyId: item.policy.id, opportunity, externalId, start: input.start, end: input.end, timeZone: input.timeZone, mainSalesProEmail, registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const };
}
function isChronological(input: SessionBody): boolean { return input.end > input.start; }
const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = { forConnection() { throw new Error("Sales Delivery is not configured."); } };
function cloudShareEvidence(error: unknown): { request: Record<string, unknown>; response: Record<string, unknown> } | undefined {
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  const context = (error as { context?: Record<string, unknown> }).context;
  if (!context) return undefined;
  return { request: { method: context.method, path: context.path, headers: context.requestHeaders, body: context.requestBody }, response: { status: context.responseStatus ?? context.status, headers: context.responseHeaders, body: context.responseBody, transport: context.cause, network: context.network, tls: context.tls } };
}
function isMainSalesProValidationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!("context" in error)) return /main.?sales.?pro|sales.?pro/i.test(error.message);
  const context = (error as { context?: Record<string, unknown> }).context;
  const response = String(context?.responseBody ?? "");
  return /main.?sales.?pro|sales.?pro/i.test(response);
}
async function rejected(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, status: number, error: string, reason: string, externalIds: Record<string, string> = {}) {
  const correlationId = randomUUID(); const now = (deps.now ?? (() => new Date()))(); const subjectId = externalIds.opportunityId ?? externalIds.itemId ?? "unprovisioned";
  await deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.demo_session.created", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: subjectId }, correlationId, message: error, externalIds, request: { method: "POST", path: "/api/sales/demo-sessions" }, response: { status }, details: { integrationSurface: "portal.sales_demo_sessions", failureMode: reason } });
  await deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId, outcome: "denied", correlationId, details: { reason, ...externalIds }, error });
  return response(status, { error, correlationId });
}
async function evidence(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, correlationId: string, session: SalesDemoSession, outcome: "success" | "failure", message: string, cloudshare: { request: unknown; response: unknown } | undefined, details: Record<string, unknown>) {
  await deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.demo_session.created", outcome, level: outcome === "failure" ? "warn" : "info", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, correlationId, message, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId, externalId: session.externalId, opportunityId: session.opportunityId, itemId: session.itemId }, request: cloudshare?.request as Record<string, unknown> | undefined, response: cloudshare?.response as Record<string, unknown> | undefined, details });
}
async function recordResourceReads(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, correlationId: string, itemId: string, projectId: string, reads: readonly { request: Record<string, unknown>; response: Record<string, unknown>; integrationSurface: string }[], outcome: "success" | "failure") {
  for (const read of reads) await deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.demo_session.item_resources.revalidated", outcome, level: outcome === "failure" ? "warn" : "info", customerId: request.customerId, actor: request.actor, correlationId, message: outcome === "success" ? "Sales Demo Item resource revalidated before provisioning" : "Sales Demo Item revalidation found stale CloudShare resources", request: read.request, response: read.response, details: { integrationSurface: read.integrationSurface }, externalIds: { itemId, projectId } });
}
