import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ItemRepository } from "@/domain/item";
import type { SalesExperienceType } from "@/domain/sales-experience-type";
import { SalesDemoSessionRevisionConflictError, type SalesDemoSession, type SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";
import { isValidCloudShareWallClock } from "@/domain/cloudshare-wall-clock";
import { isSalesSessionVerificationEligible } from "@/domain/sales-session-verification";
import { DEFAULT_SALES_SESSION_NAME_TEMPLATE, renderSalesSessionName } from "@/domain/sales-session-name";
import type { SalesSessionConfigurationRepository } from "@/domain/sales-session-configuration";
import type { SalesTimezoneCacheRepository } from "@/domain/sales-timezones";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import { CloudShareAuthError, CloudShareRequestError, CloudShareResponseError, CloudShareTransportError, isCloudShareErrorAcrossBoundaries } from "@/integrations/cloudshare/errors";
import { SalesItemProvisioningReadError, SalesItemProvisioningValidationError, type SalesItemProvisioningValidator } from "@/integrations/cloudshare/sales-item-provisioning";
import { createCloudShareProjectMemberSource, type CloudShareProjectMemberSource } from "@/integrations/cloudshare/project-members";
import { projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";

const bodySchema = z.object({
  opportunityId: z.string().trim().min(1), itemId: z.string().trim().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Start must be ISO local date-time."),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "End must be ISO local date-time."),
  salesProEmail: z.string().trim().email("Select an active Project member as the Sales Pro."),
  timeZone: z.string().trim().min(1).max(100), type: z.enum(["demo", "poc", "pov", "trial"]).default("demo"), sessionNameTemplate: z.string().trim().min(1).max(160).optional(),
});
type SessionBody = z.infer<typeof bodySchema>;
const response = (status: number, body: Record<string, unknown>) => ({ status, body });

export interface SalesDemoSessionDeps {
  readonly records: Pick<SalesRecordRepository, "findOpportunity"> & Partial<Pick<SalesRecordRepository, "findAccount">>;
  readonly items: Pick<ItemRepository, "findById">;
  readonly sessions: SalesDemoSessionRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>, options?: Parameters<CloudShareClientFactory["forConnection"]>[1]): SalesDelivery };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly itemProvisioningValidator?: SalesItemProvisioningValidator;
  readonly itemProvisioningValidatorFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>, options?: Parameters<CloudShareClientFactory["forConnection"]>[1]): SalesItemProvisioningValidator };
  readonly projectMembers?: CloudShareProjectMemberSource;
  readonly projectMemberSourceFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>, options?: Parameters<CloudShareClientFactory["forConnection"]>[1]): CloudShareProjectMemberSource };
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly settings?: SalesSessionConfigurationRepository;
  /** Cached documented v3 catalogue validates the submitted CloudShare ID. */
  readonly timezones?: Pick<SalesTimezoneCacheRepository, "find">;
  readonly now?: () => Date;
  readonly newId?: () => string;
}
export interface SalesDemoSessionRequest { readonly customerId: string; readonly actor: DiagnosticActor; readonly body?: unknown; }
export type SalesSessionCreationOutcome =
  | { readonly dimension: "certalis_creation"; readonly value: "not_created"; readonly source: "certalis_pre_dispatch"; readonly retry: "safe"; readonly reason: string }
  | { readonly dimension: "certalis_creation"; readonly value: "needs_attention"; readonly source: "cloudshare_v4_post_sales_ambiguous" | "certalis_correlation_persistence" | "certalis_support_persistence" | "reservation_cleanup_unconfirmed"; readonly retry: "unsafe_requires_support"; readonly reason: string; readonly sessionId: string };
/** Browser-safe projection; CloudShare Experience IDs remain server-side support evidence. */
export interface PortalSalesEnablementSession {
  readonly id: string;
  readonly opportunityId: string;
  readonly itemId: string;
  readonly type: SalesExperienceType;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly salesProDisplayName: string;
  readonly sessionName: string;
  readonly revision: number;
  readonly verificationEligible: boolean;
  readonly createdAt: string;
}

export function toPortalSalesEnablementSession(session: SalesDemoSession): PortalSalesEnablementSession {
  return { id: session.id, opportunityId: session.opportunityId, itemId: session.itemId, type: session.type, start: session.start, end: session.end, timeZone: session.timeZone, salesProDisplayName: session.salesProDisplayName, sessionName: session.sessionName ?? "Sales Enablement Session", revision: session.revision ?? 1, verificationEligible: isSalesSessionVerificationEligible(session), createdAt: session.createdAt.toISOString() };
}

/** API-first orchestration for a single Customer-scoped Sales Enablement Session.
 * The handler owns Certalis operation state and audit records; the deep Delivery module
 * owns all CloudShare protocol details. It intentionally does not enroll or
 * invite participants (those are follow-on slices). */
export async function handleCreateSalesDemoSession(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest) {
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) return rejected(deps, request, 400, "Invalid Sales Enablement Session request.", "invalid_request");
  if (!isChronological(parsed.data)) return rejected(deps, request, 400, "End must be after start.", "end_before_start");
  const cachedTimezones = await deps.timezones?.find(request.customerId);
  if (!cachedTimezones || !cachedTimezones.timezones.some((zone) => zone.id === parsed.data.timeZone)) return rejected(deps, request, 422, "Refresh the documented CloudShare timezone catalogue before creating a Sales Enablement Session.", "unsupported_cloudshare_timezone");
  if (!isValidCloudShareWallClock(parsed.data.start, parsed.data.timeZone) || !isValidCloudShareWallClock(parsed.data.end, parsed.data.timeZone)) return rejected(deps, request, 400, "Start and end must be unambiguous CloudShare wall-clock values in the selected time zone.", "invalid_wall_clock");
  const [opportunity, item, connection] = await Promise.all([
    deps.records.findOpportunity(request.customerId, parsed.data.opportunityId), deps.items.findById(parsed.data.itemId), deps.connections.findByCustomerId(request.customerId),
  ]);
  if (!opportunity || opportunity.customerId !== request.customerId) return rejected(deps, request, 404, "Opportunity was not found for this Customer.", "opportunity_not_found");
  if (opportunity.archivedAt) return rejected(deps, request, 409, "Archived Opportunities cannot receive new Sales Enablement Sessions.", "opportunity_archived", { opportunityId: opportunity.id });
  if (opportunity.name.length > 100) return rejected(deps, request, 422, "Opportunity name exceeds CloudShare's 100-character limit. Shorten it before provisioning.", "opportunity_name_too_long", { opportunityId: opportunity.id });
  if (!item || item.customerId !== request.customerId || item.status !== "active") return rejected(deps, request, 404, "Active Item was not found for this Customer.", "item_not_found_or_inactive", { itemId: parsed.data.itemId });
  if (!connection) return rejected(deps, request, 404, "Save a Certalis CloudShare Connection before provisioning a Sales Enablement Session.", "connection_missing");

  const opportunitySessions = (await deps.sessions.listByOpportunity(request.customerId, opportunity.id)) ?? [];
  const unresolved = opportunitySessions.find((session) => matchesUnresolvedCreateIntent(session, parsed.data));
  if (unresolved) {
    const correlationId = randomUUID();
    const occurredAt = (deps.now ?? (() => new Date()))();
    await Promise.allSettled([
      evidence(deps, request, correlationId, unresolved, "failure", "Certalis blocked a duplicate creation attempt while the prior CloudShare POST outcome remains unresolved", undefined, { integrationSurface: "cloudshare.v4.sales", failureMode: "cloudshare_create_duplicate_blocked", retry: "unsafe_requires_support" }),
      deps.audit?.write({ id: randomUUID(), occurredAt, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: unresolved.id, outcome: "denied", correlationId, details: { opportunityId: opportunity.id, itemId: item.id, failureMode: "cloudshare_create_duplicate_blocked", integrationSurface: "cloudshare.v4.sales", retry: "unsafe_requires_support" }, error: AMBIGUOUS_CREATE_REASON }),
    ]);
    return response(409, { error: AMBIGUOUS_CREATE_REASON, correlationId, needsAttention: true, creationOutcome: unsafeCreationOutcome("cloudshare_v4_post_sales_ambiguous", AMBIGUOUS_CREATE_REASON, unresolved.id) });
  }
  const id = (deps.newId ?? randomUUID)();
  const revision = opportunitySessions.length + 1;
  const account = deps.records.findAccount ? await deps.records.findAccount(request.customerId, opportunity.accountId) : null;
  const configuredTemplate = (await deps.settings?.find(request.customerId))?.template;
  const sessionName = renderSalesSessionName(parsed.data.sessionNameTemplate ?? configuredTemplate ?? DEFAULT_SALES_SESSION_NAME_TEMPLATE, { account: account?.name ?? "Account", opportunity: opportunity.name, revision, item: item.name });
  if (!sessionName) return rejected(deps, request, 422, "Session name template must include {revision} and render to at most 100 characters.", "invalid_session_name_template", { opportunityId: opportunity.id });
  // CloudShare's live v4 validator rejects separators even though the OpenAPI
  // describes ExternalId as a generic string. Keep the portal's UUID locally,
  // while sending its 32-character opaque form to CloudShare.
  const externalId = opaqueCloudShareId(id);
  // v4 currently requires a passphrase for a Sales Experience even when the
  // admission model is registered-only and native invitations are disabled.
  // It is never returned to the browser or persisted as a portal credential.
  const passphrase = opaqueCloudShareId(randomUUID());
  const correlationId = randomUUID();
  const now = (deps.now ?? (() => new Date()))();
  // Reserve before *any* CloudShare read. A rejected reservation is a wholly
  // local event, so retry safety must not depend on external preflight calls.
  const reservation: SalesDemoSession = { id, customerId: request.customerId, opportunityId: opportunity.id, itemId: item.id, cloudShareSalesExperienceId: `pending:${id}`, externalId, type: parsed.data.type, start: parsed.data.start, end: parsed.data.end, timeZone: parsed.data.timeZone, salesProEmail: parsed.data.salesProEmail, salesProDisplayName: "Pending CloudShare validation", registrationType: "registeredParticipantsOnly", sendInvitations: "salesProsAndParticipants", sessionName, revision, operationalStatus: "provisioning", createdAt: now };
  let reservationClaimed = false;
  if (deps.sessions.updateOperationalState) {
    try { await deps.sessions.save(reservation); reservationClaimed = true; }
    catch (error) {
      const clearedAmbiguousReservation = await clearAmbiguousReservation(deps.sessions, reservation, error);
      return reservationPersistenceFailure(deps, request, reservation, correlationId, now, error, clearedAmbiguousReservation);
    }
  }
  const workflowScope = certificationCloudShareWorkflow({ actor: request.actor, customerId: request.customerId, subject: { type: "sales_demo_session", id }, correlationId, source: "sales-demo-sessions" });
  const delivery = deps.deliveryFactory?.forConnection(connection, workflowScope) ?? createCloudShareSalesDelivery((deps.cloudshare ?? missingClientFactory).forConnection(connection, workflowScope));
  let createDispatched = false;
  try {
    const validator = deps.itemProvisioningValidator ?? deps.itemProvisioningValidatorFactory?.forConnection(connection, workflowScope);
    const resourceReads = validator ? await validator.revalidate(item) : [];
    await recordResourceReads(deps, request, correlationId, item.id, item.project.id, resourceReads, "success");
    // Re-read immediately before POST /sales. This deliberately accepts the
    // narrow race after this check; a cached or Item-stored member is never used.
    const projectMembers = deps.projectMembers ?? deps.projectMemberSourceFactory?.forConnection(connection, workflowScope) ?? createCloudShareProjectMemberSource((deps.cloudshare ?? missingClientFactory).forConnection(connection, workflowScope));
    let memberRead: Awaited<ReturnType<CloudShareProjectMemberSource["listActiveProjectMembers"]>>;
    try { memberRead = await projectMembers.listActiveProjectMembers(item.project.id); }
    catch (error) { throw new SalesProjectMemberReadError(error); }
    await recordProjectMemberRead(deps, request, correlationId, item.id, item.project.id, memberRead, "success");
    const selectedSalesPro = memberRead.members.find((member) => member.email.toLowerCase() === parsed.data.salesProEmail.toLowerCase());
    if (!selectedSalesPro) throw new SalesProjectMemberSelectionError("The selected Sales Pro is no longer an active member of this Item's CloudShare Project.", memberRead);
    createDispatched = true;
    const created = await delivery.createSession(toDeliveryInput(parsed.data, item, opportunity.name, externalId, passphrase, selectedSalesPro.email, sessionName));
    const session: SalesDemoSession = { ...reservation, salesProEmail: selectedSalesPro.email, salesProDisplayName: selectedSalesPro.displayName, cloudShareSalesExperienceId: created.salesExperienceId, operationalStatus: "active" };
    // Deliberate partial-failure behaviour: the external Experience is retained
    // when local persistence fails; support evidence identifies its immutable ID.
    try { if (deps.sessions.updateOperationalState) await deps.sessions.updateOperationalState(request.customerId, id, { cloudShareSalesExperienceId: created.salesExperienceId, salesProEmail: selectedSalesPro.email, salesProDisplayName: selectedSalesPro.displayName, operationalStatus: "active", attentionReason: null }); else await deps.sessions.save(session); } catch (error) {
      // Neither evidence store may erase the already-created remote ID from the
      // response: the admin must be told not to retry even during a secondary
      // observability outage.
      await Promise.allSettled([
        evidence(deps, request, correlationId, session, "failure", "CloudShare Sales Experience was created but Certalis could not persist its correlation", created, { integrationSurface: "cloudshare.v4.sales", failureMode: "local_correlation_persistence", createdSalesExperienceId: created.salesExperienceId, error: error instanceof Error ? error.message : String(error) }),
        deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "failure", correlationId, details: { cloudShareSalesExperienceId: created.salesExperienceId, opportunityId: opportunity.id, itemId: item.id, externalId, needsAttention: true }, error: error instanceof Error ? error.message : "Local correlation persistence failed" }),
      ]);
      const reason = "CloudShare created the Sales Experience, but Certalis could not save its correlation. Do not retry creation; review support diagnostics.";
      return response(503, { error: reason, correlationId, needsAttention: true, creationOutcome: unsafeCreationOutcome("certalis_correlation_persistence", reason, id) });
    }
    const afterSave = await Promise.allSettled([
      evidence(deps, request, correlationId, session, "success", "Sales Enablement Session created", created, { integrationSurface: "cloudshare.v4.sales", registrationType: session.registrationType, sendInvitations: session.sendInvitations }),
      deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "success", correlationId, details: { cloudShareSalesExperienceId: created.salesExperienceId, opportunityId: opportunity.id, itemId: item.id, externalId } }),
    ]);
    if (afterSave.some((result) => result.status === "rejected")) {
      const warning = "Sales Enablement Session was created and saved, but Certalis could not complete every support record. Do not retry creation; review support diagnostics.";
      await Promise.allSettled([deps.sessions.updateOperationalState?.(request.customerId, id, { operationalStatus: "needs_attention", attentionReason: "Certalis support evidence persistence failed after durable provider correlation" })]);
      return response(201, { session: toPortalSalesEnablementSession(session), correlationId, needsAttention: true, warning, creationOutcome: unsafeCreationOutcome("certalis_support_persistence", warning, id) });
    }
    return response(201, { session: toPortalSalesEnablementSession(session) });
  } catch (error) {
    const validationFailure = isMainSalesProValidationFailure(error);
    const memberSelectionFailure = error instanceof SalesProjectMemberSelectionError;
    const memberReadFailure = error instanceof SalesProjectMemberReadError;
    const itemValidationFailure = error instanceof SalesItemProvisioningValidationError;
    const itemReadFailure = error instanceof SalesItemProvisioningReadError;
    const preWriteAuthFailure = isPreWriteAuthFailure(error);
    const ambiguousCreate = !preWriteAuthFailure && createDispatched && !validationFailure && isOutcomeAmbiguousCreateFailure(error);
    if (ambiguousCreate) {
      await Promise.allSettled([
        deps.sessions.updateOperationalState?.(request.customerId, id, { operationalStatus: "needs_attention", attentionReason: `cloudshare_v4_post_sales_ambiguous: ${AMBIGUOUS_CREATE_REASON}` }),
        evidence(deps, request, correlationId, reservation, "failure", AMBIGUOUS_CREATE_REASON, cloudShareEvidence(error), { integrationSurface: "cloudshare.v4.sales", failureMode: "cloudshare_create_outcome_ambiguous", retry: "unsafe_requires_support", error: error instanceof Error ? error.message : String(error) }),
        deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "failure", correlationId, details: { externalId, opportunityId: opportunity.id, itemId: item.id, failureMode: "cloudshare_create_outcome_ambiguous", integrationSurface: "cloudshare.v4.sales", retry: "unsafe_requires_support" }, error: error instanceof Error ? error.message : "CloudShare POST outcome is unknown" }),
      ]);
      return response(502, { error: AMBIGUOUS_CREATE_REASON, correlationId, needsAttention: true, creationOutcome: unsafeCreationOutcome("cloudshare_v4_post_sales_ambiguous", AMBIGUOUS_CREATE_REASON, id) });
    }
    // Every proven pre-dispatch failure must release the reservation. Only the
    // OAuth case may advertise a safe retry: it is the one failure for which
    // the provider exchange is explicitly proven to have happened before the
    // Sales POST. Missing cleanup/readback is therefore fail-closed.
    const provenPreDispatchFailure = !createDispatched && (preWriteAuthFailure || validationFailure || memberSelectionFailure || memberReadFailure || itemValidationFailure || itemReadFailure);
    if (provenPreDispatchFailure) {
      const reservationCleared = !reservationClaimed || (!deps.sessions.discardReservation || !deps.sessions.findById) || await clearReservedBeforeDispatch(deps.sessions, reservation);
      if (!reservationCleared) {
        const reason = "Certalis could not confirm the pre-dispatch Sales Enablement reservation was discarded. Do not retry creation; review support diagnostics.";
        const details = { integrationSurface: "portal.sales_demo_sessions", failureMode: "reservation_cleanup_unconfirmed", cloudShareAttempted: false, retry: "unsafe_requires_support", opportunityId: reservation.opportunityId, itemId: reservation.itemId };
        await Promise.allSettled([
          evidence(deps, request, correlationId, reservation, "failure", reason, undefined, details),
          deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: reservation.id, outcome: "failure", correlationId, details, error: reason }),
        ]);
        return response(503, { error: reason, correlationId, needsAttention: true, creationOutcome: unsafeCreationOutcome("reservation_cleanup_unconfirmed", reason, reservation.id) });
      }
    }
    if (preWriteAuthFailure) {
      // Keep the safe retry contract scoped to this proven pre-write path.
    }
    if (itemValidationFailure || itemReadFailure) {
      await recordResourceReads(deps, request, correlationId, item.id, item.project.id, error.completedReads, "failure");
    }
    const causeEvidence = cloudShareEvidence(itemReadFailure || memberReadFailure ? error.cause : error);
    if (memberSelectionFailure) await recordProjectMemberRead(deps, request, correlationId, item.id, item.project.id, error.read, "failure");
    const oauthMetadata = preWriteAuthFailure ? oauthFailureMetadata(error) : undefined;
    const integrationSurface = preWriteAuthFailure ? "cloudshare.v4.oauth.token" : memberSelectionFailure || memberReadFailure ? "cloudshare.v3.project_members_gui" : itemValidationFailure || itemReadFailure ? "cloudshare.v3.sales_item_resources" : "cloudshare.v4.sales";
    const failureMode = preWriteAuthFailure ? "cloudshare_auth_pre_write" : memberReadFailure ? "project_member_read" : memberSelectionFailure ? "selected_sales_pro_inactive" : validationFailure ? "main_sales_pro_validation" : itemValidationFailure ? "item_resource_drift" : itemReadFailure ? "item_resource_read" : "cloudshare_create";
    await Promise.allSettled([
    evidence(deps, request, correlationId, { id, customerId: request.customerId, opportunityId: opportunity.id, itemId: item.id, cloudShareSalesExperienceId: "unprovisioned", externalId, type: parsed.data.type, start: parsed.data.start, end: parsed.data.end, timeZone: parsed.data.timeZone, salesProEmail: parsed.data.salesProEmail, salesProDisplayName: "unresolved", registrationType: "registeredParticipantsOnly", sendInvitations: "salesProsAndParticipants", createdAt: new Date() }, "failure", memberReadFailure ? "CloudShare could not read active Project members for the selected Sales Pro" : memberSelectionFailure ? "Selected Sales Pro is not active in this CloudShare Project" : validationFailure ? "CloudShare main Sales Pro validation failed" : itemValidationFailure ? "Catalogue Item is stale against CloudShare resources" : itemReadFailure ? "CloudShare could not fully revalidate this Catalogue Item" : preWriteAuthFailure ? "CloudShare authentication failed before the Sales Experience create request. Retry is safe." : "CloudShare Sales Experience creation failed", causeEvidence, { integrationSurface, failureMode, ...(preWriteAuthFailure ? { retry: "safe", cloudShareAttempted: false, ...oauthMetadata } : {}), error: error instanceof Error ? error.message : String(error) }),
      deps.audit?.write({ id: randomUUID(), occurredAt: (deps.now ?? (() => new Date()))(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: id, outcome: "failure", correlationId, details: { externalId, opportunityId: opportunity.id, itemId: item.id, failureMode, integrationSurface }, error: error instanceof Error ? error.message : "Unknown CloudShare failure" }),
    ]);
    const errorMessage = memberReadFailure ? "CloudShare could not retrieve active Project members. Review support diagnostics before retrying." : memberSelectionFailure ? "The selected Sales Pro is no longer an active Project member. Select a current Sales Pro and try again." : validationFailure ? "CloudShare rejected the selected Sales Pro. Review support diagnostics." : itemValidationFailure ? "This Item no longer matches its CloudShare resources. Refresh the Item before provisioning." : itemReadFailure ? "CloudShare could not fully revalidate this Item. Review support diagnostics before retrying." : preWriteAuthFailure ? "CloudShare authentication failed before creation. Retry the Sales Enablement Session." : "CloudShare could not create the Sales Experience. Review support diagnostics.";
    return response(memberSelectionFailure || validationFailure || itemValidationFailure ? 422 : preWriteAuthFailure ? 503 : 502, { error: errorMessage, correlationId, needsAttention: false, ...(preWriteAuthFailure ? { creationOutcome: safeCreationOutcome(errorMessage) } : {}) });
  }
}

function toDeliveryInput(input: SessionBody, item: { name: string; project: { id: string }; blueprints: readonly { id: string }[]; policy: { id: string }; regions: readonly { id: string }[] }, opportunity: string, externalId: string, passphrase: string, mainSalesProEmail: string, sessionName: string) {
  return { name: sessionName, type: input.type, projectId: item.project.id, blueprintIds: item.blueprints.map((blueprint) => blueprint.id), regionIds: item.regions.map((region) => region.id), policyId: item.policy.id, opportunity, externalId, passphrase, start: input.start, end: input.end, timeZone: input.timeZone, mainSalesProEmail, registrationType: "registeredParticipantsOnly" as const, sendInvitations: "salesProsAndParticipants" as const };
}
function opaqueCloudShareId(value: string): string { return value.replaceAll("-", ""); }
function isChronological(input: SessionBody): boolean { return input.end > input.start; }
const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = { forConnection() { throw new Error("Sales Delivery is not configured."); } };
function cloudShareEvidence(error: unknown): { request: Record<string, unknown> | null; response: Record<string, unknown> | null } | undefined {
  return projectCloudShareFailureEvidence(error);
}
function cloudShareErrorContext(error: unknown): Record<string, unknown> | undefined {
  return error instanceof Error && "context" in error && error.context && typeof error.context === "object" ? error.context as Record<string, unknown> : undefined;
}
function isPreWriteAuthFailure(error: unknown): boolean {
  if (error instanceof SalesItemProvisioningReadError || error instanceof SalesProjectMemberReadError) return isPreWriteAuthFailure(error.cause);
  if (!isCloudShareErrorAcrossBoundaries(error)) return false;
  const context = cloudShareErrorContext(error);
  return error instanceof CloudShareAuthError || context?.path === "/oauth/token" || context?.integrationSurface === "cloudshare.v4.oauth.token";
}
function oauthFailureMetadata(error: unknown): Record<string, unknown> {
  if (error instanceof SalesItemProvisioningReadError || error instanceof SalesProjectMemberReadError) return oauthFailureMetadata(error.cause);
  const context = cloudShareErrorContext(error) ?? {};
  const acquisition = context.acquisition && typeof context.acquisition === "object" ? context.acquisition as Record<string, unknown> : {};
  const status = typeof acquisition.status === "number" ? acquisition.status : typeof context.responseStatus === "number" ? context.responseStatus : typeof context.status === "number" ? context.status : undefined;
  return { ...(typeof acquisition.exchangeCorrelationId === "string" ? { oauthExchangeCorrelationId: acquisition.exchangeCorrelationId } : {}), ...(status === undefined ? {} : { oauthStatus: status }), ...(typeof acquisition.durationMs === "number" ? { oauthDurationMs: acquisition.durationMs } : {}), ...(typeof acquisition.failureMode === "string" ? { oauthFailureMode: acquisition.failureMode } : {}), ...(typeof context.network === "object" && context.network ? { oauthTransport: context.network } : {}), ...(typeof acquisition.causeClassification === "string" ? { oauthCause: acquisition.causeClassification } : {}) };
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
  await Promise.allSettled([
    deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.demo_session.created", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: subjectId }, correlationId, message: error, externalIds, request: { method: "POST", path: "/api/sales/demo-sessions" }, response: { status }, details: { integrationSurface: "portal.sales_demo_sessions", failureMode: reason } }),
    deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId, outcome: "denied", correlationId, details: { reason, ...externalIds }, error }),
  ]);
  return response(status, { error, correlationId });
}
async function reservationPersistenceFailure(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, reservation: SalesDemoSession, correlationId: string, occurredAt: Date, error: unknown, clearedAmbiguousReservation = false) {
  const conflict = error instanceof SalesDemoSessionRevisionConflictError;
  const failureMode = conflict ? "revision_collision" : "local_reservation_persistence";
  const message = conflict
    ? "A Sales Enablement Session is already being provisioned for this Opportunity revision. Refresh the Sales Enablement Session operations view before retrying."
    : "Certalis could not reserve the Sales Enablement Session locally. No CloudShare operation was attempted; review support diagnostics and retry.";
  const details = { integrationSurface: "portal.sales_demo_sessions", failureMode, cloudShareAttempted: false, clearedAmbiguousReservation, opportunityId: reservation.opportunityId, itemId: reservation.itemId };
  await Promise.allSettled([
    evidence(deps, request, correlationId, reservation, "failure", message, undefined, details),
    deps.audit?.write({ id: randomUUID(), occurredAt, customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: "sales.demo_session.created", subjectType: "sales_demo_session", subjectId: reservation.id, outcome: "failure", correlationId, details, error: error instanceof Error ? error.message : "Local reservation persistence failed" }),
  ]);
  return response(conflict ? 409 : 503, { error: message, correlationId, needsAttention: false, creationOutcome: safeCreationOutcome(message) });
}
async function clearAmbiguousReservation(sessions: SalesDemoSessionRepository, reservation: SalesDemoSession, error: unknown): Promise<boolean> {
  if (error instanceof SalesDemoSessionRevisionConflictError || !sessions.findById || !sessions.discardReservation) return false;
  try {
    const persisted = await sessions.findById(reservation.customerId, reservation.id);
    const isOwnPendingReservation = persisted?.id === reservation.id && persisted.customerId === reservation.customerId && persisted.opportunityId === reservation.opportunityId && persisted.revision === reservation.revision && persisted.cloudShareSalesExperienceId === reservation.cloudShareSalesExperienceId && persisted.operationalStatus === "provisioning";
    if (!isOwnPendingReservation) return false;
    const discarded = await sessions.discardReservation(reservation);
    if (!discarded) return false;
    return (await sessions.findById(reservation.customerId, reservation.id)) === null;
  } catch { return false; }
}
const AMBIGUOUS_CREATE_REASON = "CloudShare POST /sales completed without a response, so the creation outcome is unknown. Do not retry creation; review support diagnostics.";
function safeCreationOutcome(reason: string): SalesSessionCreationOutcome { return { dimension: "certalis_creation", value: "not_created", source: "certalis_pre_dispatch", retry: "safe", reason }; }
function unsafeCreationOutcome(source: Extract<SalesSessionCreationOutcome, { value: "needs_attention" }>["source"], reason: string, sessionId: string): SalesSessionCreationOutcome { return { dimension: "certalis_creation", value: "needs_attention", source, retry: "unsafe_requires_support", reason, sessionId }; }
function matchesUnresolvedCreateIntent(session: SalesDemoSession, input: SessionBody): boolean {
  return session.cloudShareSalesExperienceId.startsWith("pending:") && (session.operationalStatus === "provisioning" || session.operationalStatus === "needs_attention") && session.itemId === input.itemId && session.start === input.start && session.end === input.end && session.timeZone === input.timeZone && session.type === input.type && session.salesProEmail.toLowerCase() === input.salesProEmail.toLowerCase();
}
function isOutcomeAmbiguousCreateFailure(error: unknown): boolean {
  if (error instanceof CloudShareRequestError) return error.status >= 500;
  return error instanceof CloudShareTransportError || error instanceof CloudShareResponseError || !(error instanceof CloudShareAuthError);
}
async function clearReservedBeforeDispatch(sessions: SalesDemoSessionRepository, reservation: SalesDemoSession): Promise<boolean> {
  if (!sessions.discardReservation || !sessions.findById) return false;
  try {
    const discarded = await sessions.discardReservation(reservation);
    if (!discarded) return false;
    const remaining = await sessions.findById(reservation.customerId, reservation.id);
    return remaining === null;
  } catch {
    return false;
  }
}
async function evidence(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, correlationId: string, session: SalesDemoSession, outcome: "success" | "failure", message: string, cloudshare: { request: unknown; response: unknown } | undefined, details: Record<string, unknown>) {
  await deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.demo_session.created", outcome, level: outcome === "failure" ? "warn" : "info", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, correlationId, message, externalIds: { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId, externalId: session.externalId, opportunityId: session.opportunityId, itemId: session.itemId }, request: cloudshare?.request as Record<string, unknown> | undefined, response: cloudshare?.response as Record<string, unknown> | undefined, details });
}
async function recordResourceReads(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, correlationId: string, itemId: string, projectId: string, reads: readonly { request: Record<string, unknown>; response: Record<string, unknown>; integrationSurface: string }[], outcome: "success" | "failure") {
  await Promise.allSettled(reads.map((read) => deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.enablement_session.item_resources.revalidated", outcome, level: outcome === "failure" ? "warn" : "info", customerId: request.customerId, actor: request.actor, correlationId, message: outcome === "success" ? "Catalogue Item resource revalidated before Sales Enablement Session provisioning" : "Catalogue Item revalidation found stale CloudShare resources", request: read.request, response: read.response, details: { integrationSurface: read.integrationSurface }, externalIds: { itemId, projectId } })));
}
class SalesProjectMemberSelectionError extends Error {
  constructor(message: string, readonly read: Awaited<ReturnType<CloudShareProjectMemberSource["listActiveProjectMembers"]>>) { super(message); this.name = "SalesProjectMemberSelectionError"; }
}
class SalesProjectMemberReadError extends Error {
  constructor(readonly cause: unknown) { super("CloudShare could not read active Project members before provisioning."); this.name = "SalesProjectMemberReadError"; }
}
async function recordProjectMemberRead(deps: SalesDemoSessionDeps, request: SalesDemoSessionRequest, correlationId: string, itemId: string, projectId: string, read: Awaited<ReturnType<CloudShareProjectMemberSource["listActiveProjectMembers"]>>, outcome: "success" | "failure") {
  // Observability outages must not turn a validated, yet-to-be-created remote
  // Experience into a retry hazard. The primary creation audit still follows.
  await Promise.allSettled([deps.diagnostics?.record({ source: "sales-demo-sessions", operation: "sales.enablement_session.project_members.revalidated", outcome, level: outcome === "failure" ? "warn" : "info", customerId: request.customerId, actor: request.actor, correlationId, message: outcome === "success" ? "Active Project members revalidated before Sales Enablement Session provisioning" : "Selected Sales Pro was not active in the revalidated Project members", request: read.request as unknown as Record<string, unknown>, response: read.response as unknown as Record<string, unknown>, details: { integrationSurface: read.integrationSurface, cached: false, memberCount: read.members.length }, externalIds: { itemId, projectId } })]);
}
