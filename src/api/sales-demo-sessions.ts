import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ItemRepository, SalesExperienceType } from "@/domain/item";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";
import { createCloudShareSalesDelivery, SalesMainProValidationError, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";

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
  if (!parsed.success) return response(400, { error: "Invalid Sales Demo Session request.", issues: parsed.error.flatten().fieldErrors });
  if (!isChronological(parsed.data)) return response(400, { error: "End must be after start." });
  const [opportunity, item, connection] = await Promise.all([
    deps.records.findOpportunity(request.customerId, parsed.data.opportunityId), deps.items.findById(parsed.data.itemId), deps.connections.findByCustomerId(request.customerId),
  ]);
  if (!opportunity || opportunity.customerId !== request.customerId) return response(404, { error: "Opportunity was not found for this Customer." });
  if (opportunity.archivedAt) return response(409, { error: "Archived Opportunities cannot receive new Sales Demo Sessions." });
  if (!item || item.customerId !== request.customerId || item.status !== "active") return response(404, { error: "Active Item was not found for this Customer." });
  if (!connection) return response(404, { error: "Save a Certalis CloudShare Connection before provisioning a Sales Demo Session." });

  const id = (deps.newId ?? randomUUID)();
  // This deliberately identifies the commercial Opportunity rather than this
  // mutable UI submission: every replacement Sales Experience stays correlated
  // to the same immutable Certalis Opportunity key for future CRM mapping.
  const externalId = `certalis:opp:${opportunity.id}`;
  const correlationId = randomUUID();
  const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection));
  try {
    const validation = await delivery.validateMainSalesPro({ projectId: item.project.id, email: request.actor.email ?? "" });
    const created = await delivery.createSession(toDeliveryInput(parsed.data, item, opportunity.name, externalId, request.actor.email ?? ""));
    const now = (deps.now ?? (() => new Date()))();
    const session: SalesDemoSession = { id, customerId: request.customerId, opportunityId: opportunity.id, itemId: item.id, cloudShareSalesExperienceId: created.salesExperienceId, externalId, type: parsed.data.type ?? item.salesExperienceType, start: parsed.data.start, end: parsed.data.end, timeZone: parsed.data.timeZone, registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: now };
    // Deliberate partial-failure behaviour: the external Experience is retained
    // when local persistence fails; support evidence identifies its immutable ID.
    await deps.sessions.save(session);
    await evidence(deps, request, correlationId, session, "success", "Sales Demo Session created", created, { validationRequest: validation.request, validationResponse: validation.response, integrationSurface: "cloudshare.v4.sales", registrationType: session.registrationType, sendInvitations: session.sendInvitations });
    await deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "success", correlationId, details: { cloudShareSalesExperienceId: created.salesExperienceId, opportunityId: opportunity.id, itemId: item.id, externalId } });
    return response(201, { session });
  } catch (error) {
    const validationFailure = error instanceof SalesMainProValidationError || (error instanceof Error && /sales pro/i.test(error.message));
    const causeEvidence = error instanceof SalesMainProValidationError ? error.evidence : undefined;
    await evidence(deps, request, correlationId, { id, customerId: request.customerId, opportunityId: opportunity.id, itemId: item.id, cloudShareSalesExperienceId: "unprovisioned", externalId, type: parsed.data.type ?? item.salesExperienceType, start: parsed.data.start, end: parsed.data.end, timeZone: parsed.data.timeZone, registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend", createdAt: new Date() }, "failure", validationFailure ? "CloudShare main Sales Pro validation failed" : "CloudShare Sales Experience creation failed", causeEvidence, { integrationSurface: "cloudshare.v4.sales", failureMode: validationFailure ? "main_sales_pro_validation" : "cloudshare_create", error: error instanceof Error ? error.message : String(error) });
    await deps.audit?.write({ id: randomUUID(), occurredAt: (deps.now ?? (() => new Date()))(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "failure", correlationId, details: { externalId, opportunityId: opportunity.id, itemId: item.id }, error: error instanceof Error ? error.message : "Unknown CloudShare failure" });
    return response(validationFailure ? 422 : 502, { error: validationFailure ? "The authenticated Sales Admin is not configured as the CloudShare main Sales Pro. Review support diagnostics." : "CloudShare could not create the Sales Experience. Review support diagnostics.", correlationId });
  }
}

function toDeliveryInput(input: SessionBody, item: { name: string; project: { id: string }; blueprints: readonly { id: string }[]; policy: { id: string }; regions: readonly { id: string }[]; salesExperienceType: SalesExperienceType }, opportunity: string, externalId: string, mainSalesProEmail: string) {
  return { name: `${item.name} — ${opportunity}`.slice(0, 100), type: input.type ?? item.salesExperienceType, projectId: item.project.id, blueprintIds: item.blueprints.map((blueprint) => blueprint.id), regionIds: item.regions.map((region) => region.id), policyId: item.policy.id, opportunity, externalId, start: input.start, end: input.end, timeZone: input.timeZone, mainSalesProEmail, registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const };
}
function isChronological(input: SessionBody): boolean { return input.end > input.start; }
const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = { forConnection() { throw new Error("Sales Delivery is not configured."); } };
async function evidence(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, correlationId: string, session: SalesDemoSession, outcome: "success" | "failure", message: string, cloudshare: { request: unknown; response: unknown } | undefined, details: Record<string, unknown>) {
  await deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.demo_session.created", outcome, level: outcome === "failure" ? "warn" : "info", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, correlationId, message, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId, externalId: session.externalId, opportunityId: session.opportunityId, itemId: session.itemId }, request: cloudshare?.request as Record<string, unknown> | undefined, response: cloudshare?.response as Record<string, unknown> | undefined, details });
}
