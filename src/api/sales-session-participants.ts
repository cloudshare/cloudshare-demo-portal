import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import { projectSalesSessionAccessWindow } from "@/domain/sales-session-access-window";
import { createCloudShareSalesDelivery, requireCompleteSalesParticipantRoster, type SalesDelivery, type SalesDeliveryEvidence, type SalesDeliveryDispatchEvidence } from "@/integrations/cloudshare/sales-delivery";
import { CloudShareResponseError } from "@/integrations/cloudshare/errors";
import { projectCloudShareFailureContext, projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";
import type { EnvironmentStateEvidenceSource } from "@/domain/environment";
import type { ItemRepository } from "@/domain/item";
import { SalesEnvironmentResolutionError, type SalesEnvironmentSource } from "@/integrations/cloudshare/sales-environment";
import { isProjectableSalesParticipantRosterEnvironment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "@/domain/sales-participant-environment";
import { invitationResult, type InvitationTargetOutcome, type SalesParticipantInvitationLedger } from "@/domain/sales-participant-invitation-ledger";

const contactsSchema = z.object({ contactIds: z.array(z.string().trim().min(1)).min(1).max(100) });
const invitationCommandSchema = z.object({
  commandId: z.string().uuid(),
  targets: z.array(z.object({
    participantId: z.string().trim().min(1),
    intent: z.enum(["invite", "resend"]),
    expectedInvitationStatus: z.enum(["notSent", "sent"]),
    participantRevision: z.string().trim().min(1),
  })).min(1).max(100).superRefine((targets, context) => {
    const ids = new Set<string>();
    targets.forEach((target, index) => {
      if (ids.has(target.participantId)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "participantId"], message: "Duplicate participant target." });
      ids.add(target.participantId);
      if ((target.intent === "invite" && target.expectedInvitationStatus !== "notSent") || (target.intent === "resend" && target.expectedInvitationStatus !== "sent")) context.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Invitation intent does not match expected status." });
    });
  }),
});
type Request = { readonly customerId: string; readonly sessionId: string; readonly actor: DiagnosticActor; readonly body?: unknown };
type ParticipantDelivery = Pick<SalesDelivery, "createSession" | "readSession"> & Partial<SalesDelivery>;
type ResolutionResponse = { readonly status: number; readonly body: Record<string, unknown> };
type BaseDeps = { sessions: Pick<SalesDemoSessionRepository, "findById">; items?: Pick<ItemRepository, "findById">; records: Pick<SalesRecordRepository, "findContact"> & Partial<Pick<SalesRecordRepository, "listContacts">>; participants: Pick<SalesSessionParticipantRepository, "save" | "list"> & Partial<Pick<SalesSessionParticipantRepository, "recordEnvironmentObservation">>; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare?: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): ParticipantDelivery }; environmentFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): EnvironmentStateEvidenceSource }; salesEnvironmentFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): SalesEnvironmentSource }; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write">; now?: () => Date };
type InviteDeps = BaseDeps & { invitationLedger: SalesParticipantInvitationLedger };
type Deps = BaseDeps;

/** Deep handler interface: contacts are resolved server-side before the typed
 * CloudShare adapter is crossed. Browser-provided emails and provider URLs are
 * never accepted or returned. */
export async function handleRegisterSalesSessionParticipants(deps: BaseDeps, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = contactsSchema.safeParse(request.body); if (!parsed.success) return { status: 400, body: { error: "Select one or more Opportunity Contacts." } };
  const sessionResult = await resolveSession(deps, request); if ("response" in sessionResult) return sessionResult.response!;
  if (!projectSalesSessionAccessWindow(sessionResult.session, (deps.now ?? (() => new Date()))()).nativeInvitationsAvailable) {
    const correlationId = randomUUID(); const error = "Participant registration and repair are unavailable after this Sales Session has ended.";
    await evidence(deps, request, sessionResult.session, correlationId, "sales.demo_session.participants.registered", "failure", error, undefined, { failureMode: "sales_session_ended", contactIds: parsed.data.contactIds }, {}, false);
    return { status: 409, body: { code: "sales_session_ended", error, correlationId } };
  }
  let persistedParticipants: Awaited<ReturnType<SalesSessionParticipantRepository["list"]>>;
  try { persistedParticipants = await deps.participants.list(request.customerId, sessionResult.session.id); }
  catch { return denied(deps, request, sessionResult.session, 502, "Could not verify the persisted Sales Participant mapping.", "participant_mapping_persistence"); }
  const concludedContactIds = new Set(persistedParticipants.filter((participant) => participant.participationStatus === "concluded").map((participant) => participant.opportunityContactId));
  if (parsed.data.contactIds.some((contactId) => concludedContactIds.has(contactId))) {
    const correlationId = randomUUID(); const error = "Concluded Sales Participants cannot be registered or repaired.";
    await evidence(deps, request, sessionResult.session, correlationId, "sales.demo_session.participants.registered", "failure", error, undefined, { failureMode: "sales_participant_concluded", contactIds: parsed.data.contactIds }, {}, false);
    return { status: 409, body: { code: "sales_participant_concluded", error, correlationId } };
  }
  const deliveryResult = await resolveDelivery(deps, request); if ("response" in deliveryResult) return deliveryResult.response!;
  const prepared = { session: sessionResult.session, delivery: deliveryResult.delivery };
  const resolvedContacts = await Promise.all(parsed.data.contactIds.map((id) => deps.records.findContact(request.customerId, id)));
  if (resolvedContacts.some((contact) => !contact || contact.opportunityId !== prepared.session.opportunityId || contact.archivedAt)) return denied(deps, request, prepared.session, 404, "Selected Opportunity Contact was not found for this Session.", "contact_not_found");
  const contacts = resolvedContacts.filter((contact): contact is NonNullable<typeof contact> => contact !== null);
  const correlationId = randomUUID();
  let completedRemote: SalesDeliveryEvidence | undefined;
  const completedExchanges: Array<{ readonly request: unknown; readonly response: unknown }> = [];
  try {
    // Read the provider roster first so a subsequent local read failure still
    // leaves support with the authoritative CloudShare exchange that completed.
    const remoteBeforeRegistration = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedRemote = remoteBeforeRegistration;
    completedExchanges.push(...(remoteBeforeRegistration.exchanges ?? [remoteBeforeRegistration]));
    requireCompleteSalesParticipantRoster(remoteBeforeRegistration);
    const persisted = persistedParticipants;
    const persistedByContactId = new Map(persisted.map((participant) => [participant.opportunityContactId, participant]));
    const persistedByProviderId = new Map(persisted.map((participant) => [participant.cloudShareParticipantId, participant]));
    const contactsNeedingMapping = contacts.filter((contact) => !persistedByContactId.has(contact.id));
    const contactsByEmail = groupByNormalizedEmail(contactsNeedingMapping);
    const propertylessParticipants = remoteBeforeRegistration.participants.filter((participant) => !participantProperties(participant).certalisSalesParticipantId && !participantProperties(participant).certalisOpportunityContactId);
    const legacyByEmail = groupByNormalizedEmail(propertylessParticipants.filter((participant) => !persistedByProviderId.has(participant.id)));
    const correlatedByContactId = new Map(contactsNeedingMapping.map((contact) => [contact.id, remoteBeforeRegistration.participants.filter((participant) => participantProperties(participant).certalisOpportunityContactId === contact.id)]));
    const hasIncompleteCorrelation = remoteBeforeRegistration.participants.some((participant) => {
      const properties = participantProperties(participant);
      return Boolean(properties.certalisSalesParticipantId) !== Boolean(properties.certalisOpportunityContactId);
    });
    const hasAmbiguousExistingCorrelation = [...correlatedByContactId.values()].some((matches) => matches.length > 1 || matches.some((participant) => !participantProperties(participant).certalisSalesParticipantId));
    const hasAmbiguousLegacyBackfill = contactsNeedingMapping.some((contact) => {
      const legacyMatches = legacyByEmail.get(contact.email.toLowerCase()) ?? [];
      return legacyMatches.length > 0 && (legacyMatches.length !== 1 || (contactsByEmail.get(contact.email.toLowerCase()) ?? []).length !== 1);
    });
    const hasClaimedLegacyConflict = contactsNeedingMapping.some((contact) => propertylessParticipants.some((participant) => participant.email.toLowerCase() === contact.email.toLowerCase() && persistedByProviderId.has(participant.id)));
    const persistedLegacyByContactId = new Map(contacts.flatMap((contact) => {
      const stored = persistedByContactId.get(contact.id);
      const remote = stored ? remoteBeforeRegistration.participants.find((participant) => participant.id === stored.cloudShareParticipantId) : undefined;
      return stored && remote && !participantProperties(remote).certalisSalesParticipantId && !participantProperties(remote).certalisOpportunityContactId
        ? [[contact.id, remote] as const]
        : [];
    }));
    const hasDuplicatePersistedRepairCorrelation = [...persistedLegacyByContactId.entries()].some(([contactId, legacyParticipant]) => {
      const stored = persistedByContactId.get(contactId)!;
      return remoteBeforeRegistration.participants.some((participant) => participant.id !== legacyParticipant.id && (participantProperties(participant).certalisSalesParticipantId === stored.id || participantProperties(participant).certalisOpportunityContactId === contactId));
    });
    const hasUnrepairablePersistedMapping = contacts.some((contact) => {
      const stored = persistedByContactId.get(contact.id);
      if (!stored) return false;
      const remote = remoteBeforeRegistration.participants.find((participant) => participant.id === stored.cloudShareParticipantId);
      if (!remote) return true;
      const properties = participantProperties(remote);
      return Boolean(properties.certalisSalesParticipantId || properties.certalisOpportunityContactId)
        && (properties.certalisSalesParticipantId !== stored.id || properties.certalisOpportunityContactId !== stored.opportunityContactId);
    });
    if (hasIncompleteCorrelation || hasAmbiguousExistingCorrelation || hasAmbiguousLegacyBackfill || hasClaimedLegacyConflict || hasDuplicatePersistedRepairCorrelation || hasUnrepairablePersistedMapping) throw participantLegacyBackfillAmbiguous(remoteBeforeRegistration, contacts.length);
    const planned = new Map(contacts.map((contact) => [contact.id, {
      id: persistedByContactId.get(contact.id)?.id ?? participantProperties(correlatedByContactId.get(contact.id)?.[0]).certalisSalesParticipantId ?? stablePortalParticipantId(request.customerId, prepared.session.id, contact.id),
      contact,
    }]));
    const correlationFor = (value: { readonly id: string; readonly contact: { readonly id: string } }, existing: Readonly<Record<string, string>> = {}) => ([
      ...Object.entries(existing).filter(([name]) => name !== "certalisSalesParticipantId" && name !== "certalisOpportunityContactId").map(([name, propertyValue]) => ({ name, value: propertyValue })),
      { name: "certalisSalesParticipantId", value: value.id },
      { name: "certalisOpportunityContactId", value: value.contact.id },
    ]);
    const legacyByContactId = new Map([...persistedLegacyByContactId, ...contactsNeedingMapping.flatMap((contact) => {
      const participant = legacyByEmail.get(contact.email.toLowerCase())?.[0];
      return participant ? [[contact.id, participant] as const] : [];
    })]);
    const properties = await prepared.delivery.ensureParticipantCorrelationProperties!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(...properties.requests.map((propertyRequest, index) => ({ request: propertyRequest, response: properties.responses[index]! })));
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant_properties.ensured", "success", "CloudShare Sales Participant correlation properties confirmed", properties, {
      requiredKeys: properties.requiredKeys,
      availableKeys: properties.availableKeys,
      httpExchanges: properties.requests.map((propertyRequest, index) => ({ request: propertyRequest, response: properties.responses[index] })),
    });
    const legacyUpdates = await Promise.all([...legacyByContactId.entries()].map(async ([contactId, participant]) => {
      const value = planned.get(contactId)!;
      const remote = await prepared.delivery.updateParticipantCorrelation!(prepared.session.cloudShareSalesExperienceId, participant.id, { firstName: value.contact.firstName, lastName: value.contact.lastName, customProperties: correlationFor(value, participantProperties(participant)) });
      completedExchanges.push(remote);
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant_correlation.backfilled", "success", "Existing Sales Participant correlation properties backfilled after explicit admin selection", remote, { portalParticipantId: value.id, opportunityContactId: contactId }, { cloudShareParticipantId: participant.id });
      return remote;
    }));
    const contactsNeedingRemoteRegistration = contactsNeedingMapping.filter((contact) => !legacyByContactId.has(contact.id) && !(correlatedByContactId.get(contact.id)?.length));
    const created = contactsNeedingRemoteRegistration.length
      ? await prepared.delivery.registerParticipants!(prepared.session.cloudShareSalesExperienceId, contactsNeedingRemoteRegistration.map((contact) => {
        const value = planned.get(contact.id)!;
        return { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, customProperties: correlationFor(value) };
      }))
      : undefined;
    if (created) completedExchanges.push(created);
    const remoteAfterRegistration = legacyByContactId.size > 0 || created
      ? await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId)
      : remoteBeforeRegistration;
    completedRemote = remoteAfterRegistration;
    if (remoteAfterRegistration !== remoteBeforeRegistration) completedExchanges.push(...(remoteAfterRegistration.exchanges ?? [remoteAfterRegistration]));
    requireCompleteSalesParticipantRoster(remoteAfterRegistration);
    const participantByPortalId = new Map([...planned.values()].map((value) => [value.id, remoteAfterRegistration.participants.filter((participant) => participantProperties(participant).certalisSalesParticipantId === value.id && participantProperties(participant).certalisOpportunityContactId === value.contact.id)]));
    const remoteContactCounts = new Map<string, number>();
    for (const participant of remoteAfterRegistration.participants) { const contactId = participantProperties(participant).certalisOpportunityContactId; if (contactId) remoteContactCounts.set(contactId, (remoteContactCounts.get(contactId) ?? 0) + 1); }
    if (new Set([...planned.values()].map((value) => value.id)).size !== planned.size || [...participantByPortalId.values()].some((matches) => matches.length !== 1) || [...planned.values()].some((value) => remoteContactCounts.get(value.contact.id) !== 1)) throw participantRegistrationNotReconciled(remoteAfterRegistration, planned.size, 0);
    const now = (deps.now ?? (() => new Date()))();
    const saved = await Promise.all(contacts.map(async (contact) => { const existing = persistedByContactId.get(contact.id); if (existing) return { value: existing, contact }; const plan = planned.get(contact.id)!; const participant = participantByPortalId.get(plan.id)![0]!; const value = { id: plan.id, customerId: request.customerId, salesDemoSessionId: prepared.session.id, opportunityContactId: contact.id, cloudShareParticipantId: participant.id, invitationStatus: participant.invitationStatus, lastInvitedAt: null, invitedBy: participant.invitedBy, participationStatus: participant.participationStatus, firstJoined: participant.firstJoined, cloudShareEnvironmentId: participant.environmentId, environmentStatus: participant.envStatus ?? null, lastReconciledAt: now, createdAt: now, updatedAt: now } as const; await deps.participants.save(value); return { value, contact }; }));
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.registered", "success", "Sales Participants registered with CloudShare", remoteAfterRegistration, { contactIds: parsed.data.contactIds, registeredParticipantCount: contactsNeedingRemoteRegistration.length, adoptedLegacyParticipantCount: legacyByContactId.size - persistedLegacyByContactId.size, repairedPersistedParticipantCount: persistedLegacyByContactId.size, httpExchanges: completedExchanges }, saved.length === 1 && saved[0]!.value.cloudShareEnvironmentId ? { environmentId: saved[0]!.value.cloudShareEnvironmentId } : {});
    return { status: 201, body: { participants: saved.map(({ value, contact }) => portalParticipant(value, contact)), correlationId } };
  } catch (error) { const classifiedError = completedRemote && !hasParticipantFailureContext(error) ? participantMappingPersistenceFailed(error) : error; const failedExchange = exchange(error); return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.registered", "CloudShare could not register selected Sales Participants.", classifiedError, completedRemote, [...completedExchanges, ...priorHttpExchanges(error), ...(failedExchange ? [failedExchange] : [])]); }
}

export async function handleInviteSalesSessionParticipants(deps: InviteDeps, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = invitationCommandSchema.safeParse(request.body); if (!parsed.success) return { status: 400, body: { error: "Provide a valid invitation command with ordered participant targets." } };
  const participantIds = parsed.data.targets.map((target) => target.participantId);
  const sessionResult = await resolveSession(deps, request); if ("response" in sessionResult) return sessionResult.response!;
  let existingCommand = await deps.invitationLedger.readCommand(request.customerId, parsed.data.commandId);
  if (existingCommand && ["admitted", "dispatching"].includes(existingCommand.command.phase) && deps.invitationLedger.recoverExpiredInvitationCommand) {
    await deps.invitationLedger.recoverExpiredInvitationCommand({
      customerId: request.customerId,
      sessionId: sessionResult.session.id,
      commandId: parsed.data.commandId,
      expectedRevision: existingCommand.command.revision,
      at: (deps.now ?? (() => new Date()))(),
    });
    existingCommand = await deps.invitationLedger.readCommand(request.customerId, parsed.data.commandId);
  }
  let admission: Awaited<ReturnType<SalesParticipantInvitationLedger["admitBatch"]>>;
  let selected: Array<Awaited<ReturnType<typeof deps.participants.list>>[number] | undefined> = [];
  if (existingCommand) {
    // `admitBatch` is a read-only exact-scope check when the command exists.
    // This keeps replay independent of mutable Session/Participant state while
    // still rejecting command IDs reused with different preconditions.
    admission = await deps.invitationLedger.admitBatch({ customerId: request.customerId, sessionId: sessionResult.session.id, targets: parsed.data.targets, commandId: parsed.data.commandId, at: (deps.now ?? (() => new Date()))() });
  } else {
  const invitationWindow = projectSalesSessionAccessWindow(sessionResult.session, (deps.now ?? (() => new Date()))());
  if (!invitationWindow.nativeInvitationsAvailable) {
    const correlationId = randomUUID();
    const error = "Native invitations are unavailable after this Sales Session has ended.";
    await evidence(deps, request, sessionResult.session, correlationId, "sales.demo_session.participants.invited", "failure", error, undefined, { failureMode: "sales_session_ended", participantIds }, {}, false);
    return { status: 409, body: { code: "sales_session_ended", error, correlationId } };
  }
  const registered = await deps.participants.list(request.customerId, sessionResult.session.id);
  selected = participantIds.map((id) => registered.find((participant) => participant.id === id));
  if (selected.some((participant) => !participant)) return denied(deps, request, sessionResult.session, 404, "Selected registered Sales Participant was not found for this Session.", "participant_not_found");
  if (selected.some((participant) => participant!.participationStatus === "concluded")) {
    const correlationId = randomUUID(); const error = "Concluded Sales Participants cannot receive native invitations.";
    await evidence(deps, request, sessionResult.session, correlationId, "sales.demo_session.participants.invited", "failure", error, undefined, { failureMode: "sales_participant_concluded", participantIds }, {}, false);
    return { status: 409, body: { code: "sales_participant_concluded", error, correlationId } };
  }
    admission = await deps.invitationLedger.admitBatch({ customerId: request.customerId, sessionId: sessionResult.session.id, targets: parsed.data.targets, commandId: parsed.data.commandId, at: (deps.now ?? (() => new Date()))() });
  }
  let admittedCommand: { commandId: string; admissionToken?: string; revision: number } | undefined;
  if (admission.kind === "same_command") {
    const commandState = await deps.invitationLedger.readCommand(request.customerId, parsed.data.commandId);
    if (!commandState) return { status: 409, body: { code: "invitation_blocked", commandId: parsed.data.commandId } };
    const first = commandState;
    const currents = parsed.data.targets.map(() => commandState);
    if (first.command.commandId !== parsed.data.commandId || first.command.customerId !== request.customerId) return { status: 409, body: { code: "invitation_blocked", commandId: parsed.data.commandId } };
    const outcomes = currents.flatMap((current) => current!.outcome.targets).filter((target, index, all) => all.findIndex((candidate) => candidate.participantId === target.participantId) === index);
    const replayPhase = first.command.phase === "evaluating_confirmation" || first.command.phase === "settled" ? first.command.phase : null;
    const retainedParticipantIds = new Set(first.outcome.targets.filter((target) => target.outcome === "no_replay" || target.outcome === "confirmation_required").map((target) => target.participantId));
    const retainedResends = parsed.data.targets.filter((target) => retainedParticipantIds.has(target.participantId) && target.intent === "resend");
    const retainedInvites = parsed.data.targets.filter((target) => retainedParticipantIds.has(target.participantId) && target.intent === "invite");
    if (first.command.phase === "evaluating_confirmation" && retainedResends.length > 0 && retainedInvites.length === 0) {
      const settledOutcomes: InvitationTargetOutcome[] = parsed.data.targets.map((target) => retainedParticipantIds.has(target.participantId) ? { participantId: target.participantId, outcome: "accepted_unconfirmed", reason: null } : first.outcome.targets.find((outcome) => outcome.participantId === target.participantId) as InvitationTargetOutcome);
      await deps.invitationLedger.finishBatch({ customerId: request.customerId, commandId: parsed.data.commandId, expectedRevision: first.command.revision, expectedPhase: "evaluating_confirmation", phase: "settled", correlationId: first.command.correlationId, httpStatus: 200, resultCode: "invitation_completed", targetOutcomes: settledOutcomes });
      const settled = await deps.invitationLedger.readCommand(request.customerId, parsed.data.commandId);
      if (!settled) throw new Error("settled invitation command was not found");
      return { status: 200, body: { code: "invitation_completed", replayed: true, phase: "settled", ...settled.outcome } };
    }
    if (["confirmation_required", "blocked"].includes(first.outcome.outcome) && retainedInvites.length > 0 && replayPhase) {
      const deliveryResult = await resolveDelivery(deps, request);
      if (!("response" in deliveryResult)) {
        try {
          const registered = await deps.participants.list(request.customerId, sessionResult.session.id);
          // Capture the local projection and command revisions before observing
          // CloudShare; the atomic finish below must prove neither changed
          // during that external read.
          const roster = await deliveryResult.delivery.listParticipants!(sessionResult.session.cloudShareSalesExperienceId);
          const exactRemoteByParticipantId = new Map<string, (typeof roster.participants)[number]>();
          const retainedIds = new Set(first.outcome.targets.filter((target) => target.outcome === "no_replay" || target.outcome === "confirmation_required").map((target) => target.participantId));
          const resolvedRetainedIds = new Set<string>();
          if (roster.completeness === "complete") parsed.data.targets.filter((target) => retainedIds.has(target.participantId)).forEach((target) => {
            const stored = registered.find((participant) => participant.id === target.participantId);
            const admittedTarget = first.targets?.find((candidate) => candidate.participantId === target.participantId);
            const byParticipantKey = stored && roster.participants.filter((candidate) => participantProperties(candidate).certalisSalesParticipantId === stored.id);
            const byContactKey = stored && roster.participants.filter((candidate) => participantProperties(candidate).certalisOpportunityContactId === stored.opportunityContactId);
            const remote = stored && roster.participants.filter((candidate) => participantProperties(candidate).certalisSalesParticipantId === stored.id && participantProperties(candidate).certalisOpportunityContactId === stored.opportunityContactId);
            if (!stored || !admittedTarget || (admittedTarget.projectionRevision ?? admittedTarget.participantRevision) !== stored.updatedAt.toISOString() || byParticipantKey?.length !== 1 || byContactKey?.length !== 1 || remote?.length !== 1 || remote[0]!.id !== stored.cloudShareParticipantId || remote[0]!.invitationStatus !== "sent") return;
            exactRemoteByParticipantId.set(stored.id, remote[0]!);
            resolvedRetainedIds.add(stored.id);
          });
          if (resolvedRetainedIds.size > 0 || (first.command.phase === "evaluating_confirmation" && retainedResends.length > 0)) {
            const reconciledOutcomes: InvitationTargetOutcome[] = parsed.data.targets.map((target) => {
              if (resolvedRetainedIds.has(target.participantId)) return { participantId: target.participantId, outcome: "confirmed_by_reconciliation", reason: null };
              if (retainedResends.some((candidate) => candidate.participantId === target.participantId) && first.command.phase === "evaluating_confirmation") return { participantId: target.participantId, outcome: "accepted_unconfirmed", reason: null };
              const prior = first.outcome.targets.find((outcome) => outcome.participantId === target.participantId);
              if (!prior?.outcome) throw new Error("invitation target has no durable outcome");
              return { participantId: prior.participantId, outcome: prior.outcome, reason: prior.reason };
            });
            const unresolved = reconciledOutcomes.some((outcome) => outcome.outcome === "confirmation_required" || outcome.outcome === "no_replay");
            await deps.invitationLedger.finishBatchWithParticipantProjections({ customerId: request.customerId, commandId: parsed.data.commandId, expectedRevision: first.command.revision, expectedPhase: replayPhase, phase: unresolved ? "evaluating_confirmation" : "settled", correlationId: first.command.correlationId, httpStatus: unresolved ? 202 : 200, resultCode: unresolved ? "invitation_confirmation_required" : "command_reconciled", targetOutcomes: reconciledOutcomes, projections: parsed.data.targets.filter((target) => resolvedRetainedIds.has(target.participantId)).map((target) => {
              const stored = registered.find((participant) => participant.id === target.participantId)!;
              const remoteParticipant = exactRemoteByParticipantId.get(stored.id)!;
              return { participantId: stored.id, expectedParticipantRevision: stored.updatedAt.toISOString(), cloudShareParticipantId: remoteParticipant.id, invitationStatus: remoteParticipant.invitationStatus, lastInvitedAt: remoteParticipant.invitationStatus === "sent" ? (deps.now ?? (() => new Date()))().toISOString() : stored.lastInvitedAt?.toISOString() ?? null, invitedBy: remoteParticipant.invitedBy, participationStatus: remoteParticipant.participationStatus, firstJoined: remoteParticipant.firstJoined, cloudShareRosterEnvironmentReference: remoteParticipant.environmentId ?? null, environmentStatus: remoteParticipant.envStatus ?? null, environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: null, environmentAttentionSource: null, lastReconciledAt: (deps.now ?? (() => new Date()))().toISOString() };
            }) });
            const reconciled = await deps.invitationLedger.readCommand(request.customerId, parsed.data.commandId);
            if (!reconciled) throw new Error("reconciled invitation command was not found");
            return { status: unresolved ? 202 : 200, body: { code: unresolved ? "invitation_confirmation_required" : "command_reconciled", phase: reconciled.command.phase, ...reconciled.outcome } };
          }
        } catch { /* retained state is fail-closed when the read or CAS precondition is not provable */ }
      }
    }
    const currentResult = first.outcome;
    const status = first.command.httpStatus ?? (currentResult.outcome === "in_progress" || currentResult.outcome === "confirmation_required" ? 202
      : currentResult.outcome === "blocked" ? 409
        : currentResult.outcome === "failed_retryable" ? 502
          : 200);
    return { status, body: { code: first.command.resultCode ?? "command_replayed", replayed: true, phase: first.command.phase, ...currentResult } };
  }
  if (admission.kind !== "admitted") return { status: 409, body: { code: admission.blockReason ?? "invitation_blocked", commandId: parsed.data.commandId } };
  const preconditionMismatch = parsed.data.targets.some((target, index) => {
    const participant = selected[index]!;
    return participant.invitationStatus !== target.expectedInvitationStatus
      || participant.updatedAt.toISOString() !== target.participantRevision
      || (target.intent === "invite" && participant.invitationStatus !== "notSent")
      || (target.intent === "resend" && participant.invitationStatus !== "sent");
  });
  if (preconditionMismatch) {
    await deps.invitationLedger.failAdmitted(request.customerId, parsed.data.commandId, 1, (deps.now ?? (() => new Date()))(), { httpStatus: 409, resultCode: "participant_revision_stale", reason: "stale_revision" });
    const correlationId = randomUUID();
    const error = "One or more selected Sales Participants changed. Refresh the participant workspace before retrying.";
    await evidence(deps, request, sessionResult.session, correlationId, "sales.demo_session.participants.invited", "failure", error, undefined, { failureMode: "participant_revision_stale", participantIds }, {}, false);
    return { status: 409, body: { code: "participant_revision_stale", error, correlationId } };
  }
  admittedCommand = { commandId: parsed.data.commandId, admissionToken: admission.admissionToken, revision: 1 };
  const deliveryResult = await resolveDelivery(deps, request); if ("response" in deliveryResult) {
    await deps.invitationLedger.failAdmitted(request.customerId, admittedCommand.commandId, admittedCommand.revision, (deps.now ?? (() => new Date()))(), { httpStatus: deliveryResult.response!.status, resultCode: "not_dispatched", reason: "not_dispatched" });
    return deliveryResult.response!;
  }
  const prepared = { session: sessionResult.session, delivery: deliveryResult.delivery };
  const correlationId = randomUUID();
  let acknowledgedInvite: SalesDeliveryDispatchEvidence | undefined;
  let acknowledgementMarked = false;
  let dispatchMarked = false;
  const completedExchanges: Array<{ readonly request: unknown; readonly response: unknown }> = [];
  try {
    // CloudShare's invite endpoint acknowledges disabled invitations with an
    // empty 200. Read the documented Experience configuration first so
    // Certalis can return the actual prerequisite rather than a false success.
    const capability = await prepared.delivery.readParticipantInvitationCapability!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(capability);
    if (!capability.participantInvitationsEnabled) {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "CloudShare native invitations are disabled for this Sales Experience.", capability, { failureMode: "native_invitations_disabled", sendInvitations: capability.sendInvitations, participantIds, httpExchanges: completedExchanges });
      await deps.invitationLedger.failAdmitted(request.customerId, admittedCommand.commandId, admittedCommand.revision, (deps.now ?? (() => new Date()))(), { httpStatus: 409, resultCode: "native_invitations_disabled", reason: "failed_retryable" });
      return { status: 409, body: { code: "native_invitations_disabled", error: "CloudShare has native invitations disabled for this Sales Experience. Enable invitations in CloudShare before sending or resending.", correlationId } };
    }
    // A persisted mapping alone is not sufficient authority to resend an invite:
    // reconciliation may have already established that CloudShare no longer knows it.
    const current = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(...(current.exchanges ?? [current]));
    if (current.completeness === "incomplete") {
      await deps.invitationLedger.failAdmitted(request.customerId, admittedCommand.commandId, admittedCommand.revision, (deps.now ?? (() => new Date()))(), { httpStatus: 502, resultCode: "participant_roster_incomplete", reason: "failed_retryable" });
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "CloudShare participant roster could not be proven complete before dispatch.", current, { failureMode: "participant_invitation_confirmation", participantIds, httpExchanges: completedExchanges });
      return { status: 502, body: { code: "participant_roster_incomplete", error: "CloudShare participant roster could not be proven complete.", correlationId } };
    }
    const currentByProviderId = new Map(current.participants.map((participant) => [participant.id, participant]));
    if (selected.some((participant, index) => {
      const remote = currentByProviderId.get(participant!.cloudShareParticipantId);
      const participantKeyMatches = current.participants.filter((candidate) => participantProperties(candidate).certalisSalesParticipantId === participant!.id);
      const contactKeyMatches = current.participants.filter((candidate) => participantProperties(candidate).certalisOpportunityContactId === participant!.opportunityContactId);
      const exactMatches = current.participants.filter((candidate) => participantProperties(candidate).certalisSalesParticipantId === participant!.id && participantProperties(candidate).certalisOpportunityContactId === participant!.opportunityContactId);
      const target = parsed.data.targets[index]!;
      return participantKeyMatches.length !== 1 || contactKeyMatches.length !== 1 || exactMatches.length !== 1 || !remote || remote.id !== exactMatches[0]!.id || remote.participationStatus === "concluded"
        || remote.invitationStatus !== target.expectedInvitationStatus;
    })) {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "One or more selected Sales Participants no longer has its Certalis correlation values in CloudShare. Refresh monitoring and investigate the correlated diagnostics before inviting.", current, { failureMode: "participant_mapping_missing_from_cloudshare", participantIds, httpExchanges: completedExchanges });
      await deps.invitationLedger.failAdmitted(request.customerId, admittedCommand.commandId, admittedCommand.revision, (deps.now ?? (() => new Date()))(), { httpStatus: 409, resultCode: "participant_mapping_missing_from_cloudshare", reason: "failed_retryable" });
      return { status: 409, body: { error: "One or more selected Sales Participants need attention and cannot be invited. Refresh monitoring and investigate the correlated diagnostics.", correlationId } };
    }
    if (!deps.invitationLedger.markBatchEvaluatingConfirmation) {
      await deps.invitationLedger.failAdmitted(request.customerId, admittedCommand.commandId, admittedCommand.revision, (deps.now ?? (() => new Date()))(), { httpStatus: 500, resultCode: "invitation_ledger_unavailable", reason: "failed_retryable" });
      return { status: 500, body: { code: "invitation_ledger_unavailable", error: "The durable invitation confirmation boundary is unavailable." } };
    }
    if (admittedCommand.admissionToken) {
      await deps.invitationLedger.markBatchDispatching(request.customerId, admittedCommand.commandId, admittedCommand.admissionToken, admittedCommand.revision, (deps.now ?? (() => new Date()))());
      dispatchMarked = true;
    }
    const requested = await prepared.delivery.inviteParticipants!(prepared.session.cloudShareSalesExperienceId, selected.map((participant) => participant!.cloudShareParticipantId));
    acknowledgedInvite = requested;
    completedExchanges.push(requested);
    if (requested.dispatchOutcome !== undefined && requested.dispatchOutcome !== "acknowledged") {
      const ambiguous = requested.dispatchOutcome === "ambiguous_after_dispatch";
      const rejectedReason = requested.dispatchOutcome === "not_dispatched" ? "not_dispatched" as const : "provider_rejected" as const;
      await deps.invitationLedger.finishBatch({
        customerId: request.customerId,
        commandId: admittedCommand.commandId,
        expectedRevision: 2,
        expectedPhase: "dispatching",
        phase: "settled",
        correlationId,
        httpStatus: ambiguous ? 409 : 502,
        resultCode: ambiguous ? "invitation_no_replay" : rejectedReason,
        targetOutcomes: parsed.data.targets.map((target) => ({
          participantId: target.participantId,
          outcome: ambiguous ? "no_replay" as const : "failed_retryable" as const,
          reason: ambiguous ? "ambiguous_after_dispatch" as const : rejectedReason,
        })),
      });
      const message = ambiguous
        ? "Certalis could not prove whether CloudShare received the invitation request. Do not retry until support diagnostics are reviewed."
        : "CloudShare rejected the native invitation request. Retry after reviewing support diagnostics.";
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", message, requested, { failureMode: requested.dispatchOutcome, participantIds, httpExchanges: completedExchanges });
      const result = invitationResult({ commandId: admittedCommand.commandId, correlationId, outcomes: parsed.data.targets.map((target) => ({ participantId: target.participantId, outcome: ambiguous ? "no_replay" as const : "failed_retryable" as const, reason: ambiguous ? "ambiguous_after_dispatch" as const : rejectedReason })) });
      return { status: ambiguous ? 409 : 502, body: { code: ambiguous ? "invitation_no_replay" : rejectedReason, error: message, ...result } };
    }
    // Cross the durable acknowledgement boundary before any confirmation read.
    // A crash or replay from this point is read-only recovery, never a second POST.
    const confirmationOutcomes = parsed.data.targets.map((target) => ({ participantId: target.participantId, outcome: "confirmation_required" as const, reason: "confirmation_required" as const }));
    await deps.invitationLedger.markBatchEvaluatingConfirmation({ customerId: request.customerId, commandId: admittedCommand.commandId, admissionToken: admittedCommand.admissionToken!, expectedRevision: 2, correlationId, targetOutcomes: confirmationOutcomes, at: (deps.now ?? (() => new Date()))() });
    acknowledgementMarked = true;
    // The documented endpoint acknowledges with an empty 200 response. Treat a
    // subsequent roster read as the only authority for the participant's
    // invitation state, rather than claiming that acknowledgement is delivery.
    const afterRequest = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(...(afterRequest.exchanges ?? [afterRequest]));
    if (afterRequest.completeness === "incomplete") {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "CloudShare accepted the invitation request, but its participant roster could not be proven complete.", afterRequest, { failureMode: "participant_invitation_confirmation", participantIds, httpExchanges: completedExchanges });
      const result = invitationResult({ commandId: admittedCommand.commandId, correlationId, outcomes: confirmationOutcomes });
      return { status: 202, body: { code: "participant_roster_incomplete", error: "CloudShare accepted the invitation request, but its participant roster could not be proven complete. Do not retry until support diagnostics are reviewed.", ...result } };
    }
    const afterByProviderId = new Map(afterRequest.participants.map((participant) => [participant.id, participant]));
    const confirmed = selected.map((stored) => {
      const matches = afterRequest.participants.filter((participant) => participantProperties(participant).certalisSalesParticipantId === stored!.id && participantProperties(participant).certalisOpportunityContactId === stored!.opportunityContactId);
      const participantKeyMatches = afterRequest.participants.filter((participant) => participantProperties(participant).certalisSalesParticipantId === stored!.id);
      const contactKeyMatches = afterRequest.participants.filter((participant) => participantProperties(participant).certalisOpportunityContactId === stored!.opportunityContactId);
      const participant = afterByProviderId.get(stored!.cloudShareParticipantId);
      return matches.length === 1 && participantKeyMatches.length === 1 && contactKeyMatches.length === 1 && participant && participantProperties(participant).certalisSalesParticipantId === stored!.id && participantProperties(participant).certalisOpportunityContactId === stored!.opportunityContactId
        ? { stored: stored!, before: currentByProviderId.get(stored!.cloudShareParticipantId)!, participant }
        : undefined;
    });
    const confirmedParticipants = confirmed.filter((value): value is NonNullable<typeof value> => value !== undefined);
    const now = (deps.now ?? (() => new Date()))();
    // The timestamp records this explicit request only after CloudShare has
    // acknowledged it and the authoritative follow-up roster confirms sent.
    const targetOutcomes = parsed.data.targets.map((target, index) => {
      const match = confirmed[index];
      if (target.intent === "resend") return { participantId: target.participantId, outcome: "accepted_unconfirmed" as const, reason: null };
      if (match?.participant.invitationStatus === "sent") return { participantId: target.participantId, outcome: "confirmed" as const, reason: null };
      return { participantId: target.participantId, outcome: "confirmation_required" as const, reason: "confirmation_required" as const };
    });
    const confirmedParticipantCount = targetOutcomes.filter((target) => target.outcome === "confirmed").length;
    const pendingConfirmationParticipantCount = targetOutcomes.filter((target) => target.outcome !== "confirmed").length;
    const alreadySentParticipantCount = confirmedParticipants.filter(({ before, participant }) => before.invitationStatus === "sent" && participant.invitationStatus === "sent").length;
    const invitationConfirmation = pendingConfirmationParticipantCount === 0 ? "confirmed" : "pending";
    const finalStatus = targetOutcomes.some((target) => target.outcome === "confirmation_required") ? 202 : 200;
    await deps.invitationLedger.finishBatchWithParticipantProjections({
      customerId: request.customerId,
      commandId: admittedCommand.commandId,
      expectedRevision: 3,
      expectedPhase: "evaluating_confirmation",
      phase: targetOutcomes.every((target) => target.outcome === "confirmed" || target.outcome === "accepted_unconfirmed") ? "settled" : "evaluating_confirmation",
      correlationId,
      httpStatus: finalStatus,
      resultCode: finalStatus === 202 ? "invitation_confirmation_required" : "invitation_completed",
      targetOutcomes,
      projections: confirmedParticipants.filter(({ stored }) => targetOutcomes.find((target) => target.participantId === stored.id)?.outcome === "confirmed").map(({ stored, participant }) => ({
        participantId: stored.id,
        expectedParticipantRevision: stored.updatedAt.toISOString(),
        cloudShareParticipantId: participant.id,
        invitationStatus: participant.invitationStatus,
        lastInvitedAt: participant.invitationStatus === "sent" ? now.toISOString() : stored.lastInvitedAt?.toISOString() ?? null,
        invitedBy: participant.invitedBy,
        participationStatus: participant.participationStatus,
        firstJoined: participant.firstJoined,
        cloudShareRosterEnvironmentReference: participant.environmentId ?? null,
        environmentStatus: participant.envStatus ?? null,
        environmentStatusCode: null,
        environmentObservedAt: null,
        environmentAttentionReason: null,
        environmentAttentionSource: null,
        lastReconciledAt: now.toISOString(),
      })),
    });
    const message = invitationConfirmation === "confirmed"
      ? "CloudShare confirmed native invitations for selected Sales Participants."
      : "CloudShare accepted the native invitation request, but has not yet confirmed the invitation as sent.";
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "success", message, requested, { participantIds, confirmedParticipantCount, pendingConfirmationParticipantCount, ...(alreadySentParticipantCount > 0 ? { alreadySentParticipantCount } : {}), httpExchanges: completedExchanges });
    const result = invitationResult({ commandId: admittedCommand.commandId, correlationId, outcomes: targetOutcomes });
    return { status: finalStatus, body: { ...result, invitationConfirmation, confirmedParticipantCount, pendingConfirmationParticipantCount } };
  }
  catch (error) {
    const failedExchange = exchange(error);
    if (!dispatchMarked) {
      await deps.invitationLedger.failAdmitted(request.customerId, admittedCommand.commandId, admittedCommand.revision, (deps.now ?? (() => new Date()))(), { httpStatus: 502, resultCode: "not_dispatched", reason: "not_dispatched" });
      return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "Certalis could not prepare the native invitation request. Retry after reviewing support diagnostics.", error, undefined, [...completedExchanges, ...(failedExchange ? [failedExchange] : [])]);
    }
    if (acknowledgedInvite) {
      const durable = acknowledgementMarked ? null : await deps.invitationLedger.readCommand(request.customerId, admittedCommand.commandId);
      const acknowledgementPersisted = acknowledgementMarked || (durable?.command.phase === "evaluating_confirmation" && durable.command.correlationId === correlationId);
      const failureOutcomes = parsed.data.targets.map((target) => acknowledgementPersisted && target.intent === "resend"
        ? { participantId: target.participantId, outcome: "accepted_unconfirmed" as const, reason: null }
        : { participantId: target.participantId, outcome: acknowledgementPersisted ? "confirmation_required" as const : "no_replay" as const, reason: acknowledgementPersisted ? "confirmation_required" as const : "ambiguous_after_dispatch" as const });
      const currentRevision = acknowledgementMarked ? 3 : durable?.command.revision;
      const currentPhase = acknowledgementMarked ? "evaluating_confirmation" as const : durable?.command.phase;
      if (currentRevision && (currentPhase === "dispatching" || currentPhase === "evaluating_confirmation")) {
        await deps.invitationLedger.finishBatch({ customerId: request.customerId, commandId: admittedCommand.commandId, expectedRevision: currentRevision, expectedPhase: currentPhase, phase: failureOutcomes.some((target) => target.outcome === "confirmation_required") ? "evaluating_confirmation" : "settled", correlationId, httpStatus: acknowledgementPersisted ? 202 : 409, resultCode: acknowledgementPersisted ? "invitation_confirmation_required" : "invitation_no_replay", targetOutcomes: failureOutcomes });
      }
      await failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "CloudShare accepted the native invitation request, but Certalis could not confirm or save its result. Do not retry until support diagnostics are reviewed.", participantInvitationConfirmationFailed(error), acknowledgedInvite, [...completedExchanges, ...priorHttpExchanges(error), ...(failedExchange ? [failedExchange] : [])]);
      const result = invitationResult({ commandId: admittedCommand.commandId, correlationId, outcomes: failureOutcomes });
      return { status: acknowledgementPersisted ? 202 : 409, body: { code: acknowledgementPersisted ? "invitation_confirmation_required" : "invitation_no_replay", error: "CloudShare accepted the native invitation request, but Certalis could not confirm or save its result. Do not retry until support diagnostics are reviewed.", ...result } };
    }
    // Once the durable dispatch marker exists, an unclassified failure has no
    // proof that the provider was never reached. Fail closed and retain the
    // fence; retryability requires an explicit typed not_dispatched proof.
    await deps.invitationLedger.finishBatch({ customerId: request.customerId, commandId: admittedCommand.commandId, expectedRevision: 2, expectedPhase: "dispatching", phase: "settled", correlationId, httpStatus: 409, resultCode: "invitation_no_replay", targetOutcomes: parsed.data.targets.map((target) => ({ participantId: target.participantId, outcome: "no_replay" as const, reason: "ambiguous_after_dispatch" as const })) });
    await failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "Certalis could not prove whether CloudShare received the invitation request. Do not retry until support diagnostics are reviewed.", error, undefined, [...completedExchanges, ...priorHttpExchanges(error), ...(failedExchange ? [failedExchange] : [])]);
    const result = invitationResult({ commandId: admittedCommand.commandId, correlationId, outcomes: parsed.data.targets.map((target) => ({ participantId: target.participantId, outcome: "no_replay" as const, reason: "ambiguous_after_dispatch" as const })) });
    return { status: 409, body: { code: "invitation_no_replay", error: "Certalis could not prove whether CloudShare received the invitation request. Do not retry until support diagnostics are reviewed.", ...result } };
  }
}

export async function handleListSalesSessionParticipants(deps: BaseDeps, request: Omit<Request, "body">): Promise<{ status: number; body: Record<string, unknown> }> {
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
  const correlationId = randomUUID();
  let completedRemote: Awaited<ReturnType<NonNullable<SalesDelivery["listParticipants"]>>> | undefined;
  try {
    const remote = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedRemote = remote;
    requireCompleteSalesParticipantRoster(remote);
    const local = await deps.participants.list(request.customerId, prepared.session.id);
    const now = (deps.now ?? (() => new Date()))();
    const connection = deps.salesEnvironmentFactory ? await deps.connections.findByCustomerId(request.customerId) : null;
    const environmentSource = connection && deps.salesEnvironmentFactory ? deps.salesEnvironmentFactory.forConnection(connection) : null;
    const legacyConnection = !environmentSource && deps.environmentFactory ? await deps.connections.findByCustomerId(request.customerId) : null;
    const legacyEnvironmentSource = legacyConnection && deps.environmentFactory ? deps.environmentFactory.forConnection(legacyConnection) : null;
    const item = environmentSource && deps.items ? await deps.items.findById(prepared.session.itemId) : null;
    if (item && item.customerId !== request.customerId) throw new Error("Sales Session Item was not found for this Customer");
    const recovery = await recoverMissingParticipantMappings(deps, request.customerId, prepared.session, local, remote.participants, now);
    // `save` is an upsert on the Contact mapping. Re-read after recovery so a
    // concurrent refresh returns the canonical persisted portal ID, not the
    // losing request's provisional random ID.
    const mappedParticipants = recovery.recoveredParticipantCount > 0
      ? await deps.participants.list(request.customerId, prepared.session.id)
      : recovery.participants;
    if (recovery.unmatchedCloudShareParticipantCount > 0) {
      throw participantRosterMappingUnresolved(remote, remote.participants.length, local.length, recovery.recoveredParticipantCount, recovery.unmatchedCloudShareParticipantCount);
    }
    let missingCloudShareParticipantCount = 0;
    let correlationRepairRequiredCount = 0;
    const reconciled = await mapWithConcurrency(mappedParticipants, 4, async (stored) => {
      const participant = remote.participants.find((value) => participantProperties(value).certalisSalesParticipantId === stored.id && participantProperties(value).certalisOpportunityContactId === stored.opportunityContactId);
      const providerParticipant = participant ?? remote.participants.find((value) => value.id === stored.cloudShareParticipantId);
      const requiresCorrelationRepair = !participant && Boolean(providerParticipant) && !participantProperties(providerParticipant).certalisSalesParticipantId && !participantProperties(providerParticipant).certalisOpportunityContactId;
      const current = participant ? {
        ...stored,
        cloudShareParticipantId: participant.id,
        invitationStatus: participant.invitationStatus,
        invitedBy: participant.invitedBy,
        participationStatus: participant.participationStatus,
        firstJoined: participant.firstJoined,
        cloudShareEnvironmentId: participant.environmentId,
        environmentStatus: participant.envStatus ?? null,
        lastReconciledAt: now,
        updatedAt: now,
      } : stored;
      if (participant) {
        await deps.participants.save(current);
        let observed = current;
        if (isProjectableSalesParticipantRosterEnvironment(participant.envStatus)) {
          // The documented v4 roster is authoritative when it has a state.
          // Its terminal states can remain meaningful when the separately
          // labelled current v3 list observation has no exact match.
          observed = { ...current, environmentStatusCode: null, environmentObservedAt: now, environmentAttentionReason: null, environmentAttentionSource: null };
          await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: now });
        } else if (!current.cloudShareEnvironmentId) {
          observed = { ...current, environmentStatusCode: null, environmentObservedAt: null };
          await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: null });
        } else if (environmentSource && item) {
          const contact = await deps.records.findContact(request.customerId, current.opportunityContactId);
          if (!contact) throw new Error("Sales Participant Contact was not found for this Customer");
          try {
            const observation = await environmentSource.observe({ ownerEmail: contact.email, projectId: item.project.id });
            observed = { ...current, environmentStatusCode: observation.statusCode, environmentObservedAt: now, environmentAttentionReason: null, environmentAttentionSource: null };
            const last = observation.exchanges.at(-1)!;
            try { await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: observation.statusCode, observedAt: now }); }
            catch (error) { throw salesEnvironmentObservationPersistenceFailed(error, last as never); }
            await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.environment_observed", "success", "CloudShare Environment state observed", last, { integrationSurface: "cloudshare.v3.environments", observation: "observed", resolutionSource: "owner_email_and_item_project", portalParticipantId: current.id }, {}, true, { httpExchanges: observation.exchanges });
          } catch (error) {
            if (error instanceof SalesEnvironmentResolutionError) {
              await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: null, attentionReason: error.reason, attentionSource: "cloudshare_v3_owner_email_item_project" });
              observed = { ...current, environmentStatusCode: null, environmentObservedAt: null, environmentAttentionReason: error.reason, environmentAttentionSource: "cloudshare_v3_owner_email_item_project" };
              const actual = error.exchanges.at(-1)!;
              await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.environment_observed", "failure", error.message, actual, { integrationSurface: "cloudshare.v3.environments", observation: "needs_attention", attentionReason: error.reason, attentionSource: "cloudshare_v3_owner_email_item_project", portalParticipantId: current.id }, {}, true, { httpExchanges: error.exchanges });
            } else {
              try { await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: null }); } catch { /* Preserve the provider/persistence error and its exchange. */ }
              throw error;
            }
          }
        } else if (legacyEnvironmentSource) {
          let read: Awaited<ReturnType<EnvironmentStateEvidenceSource["readEnvironmentState"]>>;
          try { read = await legacyEnvironmentSource.readEnvironmentState(current.cloudShareEnvironmentId); }
          catch (error) { await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: null }); throw error; }
          if (read.snapshot?.statusCode) {
            observed = { ...current, environmentStatusCode: read.snapshot.statusCode, environmentObservedAt: now };
            try { await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: read.snapshot.statusCode, observedAt: now }); } catch (error) { throw environmentObservationPersistenceFailed(error, read); }
            await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.environment_observed", "success", "CloudShare Environment state observed", { request: read.request, response: read.response }, { integrationSurface: "cloudshare.v3.environments", observation: "observed", portalParticipantId: current.id }, { environmentId: current.cloudShareEnvironmentId });
          } else if (!read.snapshot) {
            observed = { ...current, environmentStatusCode: null, environmentObservedAt: null }; await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: null });
            await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.environment_observed", "success", "CloudShare Environment no longer exists", { request: read.request, response: read.response }, { integrationSurface: "cloudshare.v3.environments", observation: "not_found", portalParticipantId: current.id }, { environmentId: current.cloudShareEnvironmentId });
          } else { observed = { ...current, environmentStatusCode: null, environmentObservedAt: null }; await deps.participants.recordEnvironmentObservation?.(request.customerId, current.id, { statusCode: null, observedAt: null }); throw environmentObservationUnrecognized(read); }
        }
        return { current: observed, participant, contact: await deps.records.findContact(request.customerId, observed.opportunityContactId), requiresCorrelationRepair };
      } else if (requiresCorrelationRepair) correlationRepairRequiredCount += 1; else missingCloudShareParticipantCount += 1;
      const contact = await deps.records.findContact(request.customerId, current.opportunityContactId);
      return { current, participant, contact, requiresCorrelationRepair };
    });
    const projected = reconciled.map(({ current, participant, contact, requiresCorrelationRepair }) => contact ? portalParticipant(current, contact, participant ? undefined : requiresCorrelationRepair ? { needsAttention: true, requiresCorrelationRepair: true, monitoringMessage: "CloudShare returned this participant without its Certalis correlation properties. Select this Contact above to repair the mapping before inviting." } : { needsAttention: true, monitoringMessage: "CloudShare no longer returned this registered participant. Do not resend; investigate the correlated diagnostics." }) : null);
    const reconciliationFailed = missingCloudShareParticipantCount > 0 || correlationRepairRequiredCount > 0;
    const reconciliationMessage = correlationRepairRequiredCount > 0 && missingCloudShareParticipantCount === 0
      ? "CloudShare returned one or more Sales Participants without their Certalis correlation properties; select those Contacts to repair the mappings."
      : missingCloudShareParticipantCount > 0
        ? "CloudShare did not return one or more registered Sales Participants; those mappings need attention."
        : "Sales Participant monitoring state reconciled from CloudShare";
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.reconciled", reconciliationFailed ? "failure" : "success", reconciliationMessage, remote, { localParticipantCount: local.length, cloudShareParticipantCount: remote.participants.length, recoveredParticipantCount: recovery.recoveredParticipantCount, participantCount: reconciled.length, httpExchanges: remote.exchanges ?? [remote], ...(missingCloudShareParticipantCount > 0 ? { missingCloudShareParticipantCount } : {}), ...(correlationRepairRequiredCount > 0 ? { correlationRepairRequiredCount } : {}) });
    // Keep each mapping independently searchable. `externalIds` is deliberately a
    // string map, so a multi-participant reconciliation cannot be represented by
    // putting an array there without breaking diagnostics lookup semantics.
    await Promise.all(reconciled.map(({ current, participant, requiresCorrelationRepair }) => evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.reconciled", participant ? "success" : "failure", participant ? "Sales Participant monitoring mapping reconciled from CloudShare" : requiresCorrelationRepair ? "CloudShare returned this Sales Participant but its Certalis correlation properties need repair." : "CloudShare no longer returned this registered Sales Participant mapping.", undefined, { portalParticipantId: current.id, opportunityContactId: current.opportunityContactId, ...(participant ? {} : { failureMode: requiresCorrelationRepair ? "participant_correlation_properties_missing" : "participant_mapping_missing_from_cloudshare" }) }, { cloudShareParticipantId: current.cloudShareParticipantId, ...(current.cloudShareEnvironmentId ? { environmentId: current.cloudShareEnvironmentId } : {}) })));
    const accessWindow = projectSalesSessionAccessWindow(prepared.session, (deps.now ?? (() => new Date()))());
    return { status: 200, body: { session: { id: prepared.session.id, start: prepared.session.start, end: prepared.session.end, timeZone: prepared.session.timeZone, accessWindow }, participants: projected.filter((participant): participant is NonNullable<typeof participant> => participant !== null), correlationId } }; }
  catch (error) {
    const classifiedError = completedRemote && !hasParticipantFailureContext(error)
      ? participantMappingPersistenceFailed(error)
      : error;
    return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.reconciled", "CloudShare could not reconcile Sales Participant monitoring.", classifiedError, completedRemote);
  }
}

type RemoteSalesParticipant = {
  readonly id: string;
  readonly email: string;
  readonly invitationStatus: "sent" | "notSent";
  readonly invitedBy: string | null;
  readonly participationStatus: "pending" | "inProgress" | "concluded";
  readonly firstJoined: string | null;
  readonly environmentId: string | null;
  readonly envStatus: string | null;
  readonly customProperties?: Readonly<Record<string, string>>;
};

function participantProperties(participant: RemoteSalesParticipant | undefined): Readonly<Record<string, string>> { return participant?.customProperties ?? {}; }
function stablePortalParticipantId(customerId: string, sessionId: string, contactId: string): string { const hash = createHash("sha256").update(`${customerId}:${sessionId}:${contactId}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`; }

/** Repairs mappings only from the immutable Certalis identifiers stored in the
 * provider participant. Email is deliberately not a recovery key: it is mutable
 * and cannot distinguish otherwise identical Opportunity Contacts. */
async function recoverMissingParticipantMappings(
  deps: Deps,
  customerId: string,
  session: { readonly id: string; readonly opportunityId: string },
  local: readonly import("@/domain/sales-session-participant").SalesSessionParticipant[],
  remote: readonly RemoteSalesParticipant[],
  now: Date,
): Promise<{
  readonly participants: readonly import("@/domain/sales-session-participant").SalesSessionParticipant[];
  readonly recoveredParticipantCount: number;
  readonly unmatchedCloudShareParticipantCount: number;
}> {
  const remoteByPortalId = new Map<string, RemoteSalesParticipant[]>();
  const remoteByContactId = new Map<string, RemoteSalesParticipant[]>();
  for (const participant of remote) {
    const portalId = participantProperties(participant).certalisSalesParticipantId;
    const contactId = participantProperties(participant).certalisOpportunityContactId;
    if (portalId) remoteByPortalId.set(portalId, [...(remoteByPortalId.get(portalId) ?? []), participant]);
    if (contactId) remoteByContactId.set(contactId, [...(remoteByContactId.get(contactId) ?? []), participant]);
  }
  const localByPortalId = new Map(local.map((participant) => [participant.id, participant]));
  const localContactIds = new Set(local.map((participant) => participant.opportunityContactId));
  const recovered = (await Promise.all(remote.map(async (participant) => {
    const portalId = participantProperties(participant).certalisSalesParticipantId;
    const contactId = participantProperties(participant).certalisOpportunityContactId;
    if (!portalId || !contactId || localByPortalId.has(portalId) || localContactIds.has(contactId) || remoteByPortalId.get(portalId)?.length !== 1 || remoteByContactId.get(contactId)?.length !== 1) return undefined;
    const contact = await deps.records.findContact(customerId, contactId);
    if (!contact || contact.opportunityId !== session.opportunityId || contact.archivedAt) return undefined;
    return {
      id: portalId,
      customerId,
      salesDemoSessionId: session.id,
      opportunityContactId: contactId,
      cloudShareParticipantId: participant.id,
      invitationStatus: participant.invitationStatus,
      lastInvitedAt: null,
      invitedBy: participant.invitedBy,
      participationStatus: participant.participationStatus,
      firstJoined: participant.firstJoined,
      cloudShareEnvironmentId: participant.environmentId,
      environmentStatus: participant.envStatus,
      lastReconciledAt: now,
      createdAt: now,
      updatedAt: now,
    } as const;
  }))).filter((participant): participant is NonNullable<typeof participant> => Boolean(participant));
  try {
    await Promise.all(recovered.map((participant) => deps.participants.save(participant)));
  } catch (error) {
    throw participantMappingPersistenceFailed(error);
  }
  const knownProviderIds = new Set([
    ...local.map((participant) => participant.cloudShareParticipantId),
    ...recovered.map((participant) => participant.cloudShareParticipantId),
    ...remote.filter((participant) => {
      const portalId = participantProperties(participant).certalisSalesParticipantId;
      const contactId = participantProperties(participant).certalisOpportunityContactId;
      return Boolean(portalId && contactId && localByPortalId.get(portalId)?.opportunityContactId === contactId);
    }).map((participant) => participant.id),
  ]);
  return { participants: [...local, ...recovered], recoveredParticipantCount: recovered.length, unmatchedCloudShareParticipantCount: remote.filter((participant) => !knownProviderIds.has(participant.id)).length };
}

function portalParticipant(value: import("@/domain/sales-session-participant").SalesSessionParticipant, contact: { readonly firstName: string; readonly lastName: string; readonly email: string }, reconciliation?: { readonly needsAttention: true; readonly requiresCorrelationRepair?: true; readonly monitoringMessage: string }) { const environmentAttention = value.environmentAttentionReason ? { needsAttention: true as const, attentionReason: value.environmentAttentionReason, attentionSource: value.environmentAttentionSource ?? "cloudshare_v3_owner_email_item_project", monitoringMessage: "CloudShare Environment resolution needs attention; inspect protected diagnostics before retrying." } : {}; const environment = isProjectableSalesParticipantRosterEnvironment(value.environmentStatus) && value.environmentObservedAt ? projectSalesParticipantRosterEnvironment(value.environmentStatus, value.environmentObservedAt) : value.environmentStatusCode ? projectSalesParticipantEnvironment(value.environmentStatusCode, value.environmentObservedAt ?? undefined) : projectSalesParticipantEnvironment(value.cloudShareEnvironmentId ? 0 : null); return { id: value.id, opportunityContactId: value.opportunityContactId, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, invitationStatus: value.invitationStatus, lastInvitedAt: value.lastInvitedAt?.toISOString() ?? null, invitedBy: value.invitedBy, participationStatus: value.participationStatus, firstJoined: value.firstJoined, envStatus: value.environmentStatus, rosterEnvironmentStatus: value.environmentStatus, environment, ...environmentAttention, ...reconciliation }; }
async function resolveSession(deps: BaseDeps, request: Omit<Request, "body">): Promise<{ readonly session: SalesDemoSession } | { readonly response: ResolutionResponse }> { if (!deps.sessions.findById) return { response: { status: 503, body: { error: "Sales Participant monitoring is unavailable." } } }; const session = await deps.sessions.findById(request.customerId, request.sessionId); if (!session) return { response: { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } } }; if (session.operationalStatus !== "active" || session.cloudShareSalesExperienceId.startsWith("pending:")) return { response: { status: 409, body: { error: "Participants are available only after this Sales Session is provisioned." } } }; return { session }; }
async function resolveDelivery(deps: BaseDeps, request: Omit<Request, "body">): Promise<{ readonly delivery: ParticipantDelivery } | { readonly response: ResolutionResponse }> { const connection = await deps.connections.findByCustomerId(request.customerId); if (!connection) return { response: { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } } }; const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery(deps.cloudshare!.forConnection(connection, { scope: "customer_default", reason: "unanchored_support_read" })); return { delivery }; }
async function resolve(deps: BaseDeps, request: Omit<Request, "body">): Promise<{ readonly session: SalesDemoSession; readonly delivery: ParticipantDelivery } | { readonly response: ResolutionResponse }> { const sessionResult = await resolveSession(deps, request); if ("response" in sessionResult) return sessionResult; const deliveryResult = await resolveDelivery(deps, request); return "response" in deliveryResult ? deliveryResult : { session: sessionResult.session, delivery: deliveryResult.delivery }; }
async function denied(deps: Deps, request: Request, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, status: number, error: string, failureMode: string) { const correlationId = randomUUID(); await evidence(deps, request, session, correlationId, "sales.demo_session.participants.registered", "failure", error, undefined, { failureMode }); return { status, body: { error, correlationId } }; }
async function failed(deps: Deps, request: Request, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, correlationId: string, operation: string, message: string, error: unknown, completedRemote?: { request: unknown; response: unknown }, httpExchanges: readonly { readonly request: unknown; readonly response: unknown }[] = []) { await evidence(deps, request, session, correlationId, operation, "failure", message, exchange(error) ?? completedRemote, { integrationSurface: participantIntegrationSurface(error), ...participantFailureDetails(error), error: error instanceof Error ? error.message : String(error), ...(httpExchanges.length > 0 ? { httpExchanges } : {}) }); return { status: 502, body: { error: message, correlationId } }; }
async function evidence(deps: Deps, request: Omit<Request, "body">, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, correlationId: string, operation: string, outcome: "success" | "failure", message: string, remote: { request: unknown; response: unknown } | undefined, details: Record<string, unknown>, externalIds: Record<string, string> = {}, includeProviderId = true, protectedDetails: Record<string, unknown> = {}) { const correlatedExternalIds = { opportunityId: session.opportunityId, ...(includeProviderId ? { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId } : {}), ...externalIds }; const auditDetails = Object.fromEntries(Object.entries(details).filter(([key]) => !["httpExchanges", "cloudShareSalesExperienceId", "cloudShareParticipantId", "environmentId"].includes(key))); await Promise.allSettled([deps.diagnostics?.record({ source: "sales-session-participants", operation, outcome, level: outcome === "success" ? "info" : "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, correlationId, message, externalIds: correlatedExternalIds, request: remote?.request as Record<string, unknown>, response: remote?.response as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales.participants", ...details, ...protectedDetails } }), deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: operation, subjectType: "sales_demo_session", subjectId: session.id, outcome, correlationId, details: { opportunityId: session.opportunityId, ...auditDetails }, ...(outcome === "failure" ? { error: message } : {}) })]); }
function exchange(error: unknown): { readonly request: unknown; readonly response: unknown } | undefined {
  const projected = projectCloudShareFailureEvidence(error);
  if (projected) return projected;
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  const c = (error as { context?: Record<string, unknown> }).context;
  if (!c || typeof c.method !== "string" || typeof c.path !== "string") return undefined;
  return projectCloudShareFailureContext(c);
}
function priorHttpExchanges(error: unknown): readonly { readonly request: unknown; readonly response: unknown }[] { if (!(error instanceof Error) || !("context" in error)) return []; const exchanges = (error as { context?: { priorHttpExchanges?: unknown } }).context?.priorHttpExchanges; return Array.isArray(exchanges) ? exchanges.filter((value): value is { readonly request: unknown; readonly response: unknown } => Boolean(value && typeof value === "object" && "request" in value && "response" in value)) : []; }
type ParticipantFailureMode = "cloudshare_participants" | "http_failure" | "transport_failure" | "environment_not_found_for_project" | "environment_ambiguous_for_project" | "environment_status_observation" | "environment_observation_persistence" | "participant_page_count_contradiction" | "participant_page_duplicate_id" | "participant_registration_not_reconciled" | "participant_roster_mapping_unresolved" | "participant_mapping_persistence" | "participant_invitation_confirmation" | "sales_participant_correlation_properties_missing" | "participant_legacy_backfill_ambiguous";
function participantFailureDetails(error: unknown): { readonly failureMode: ParticipantFailureMode; readonly status?: number; readonly expectedCount?: number; readonly returnedCount?: number; readonly localParticipantCount?: number; readonly cloudShareParticipantCount?: number; readonly recoveredParticipantCount?: number; readonly unmatchedCloudShareParticipantCount?: number } {
  const context = error instanceof Error && "context" in error ? (error as { context?: Record<string, unknown> }).context : undefined;
  const oauthFailure = context?.path === "/oauth/token" || context?.integrationSurface === "cloudshare.v4.oauth.token";
  const status = typeof context?.responseStatus === "number" ? context.responseStatus : typeof context?.status === "number" ? context.status : undefined;
  const failureMode: ParticipantFailureMode = context?.failureMode === "environment_not_found_for_project" || context?.failureMode === "environment_ambiguous_for_project" || context?.failureMode === "environment_status_observation" || context?.failureMode === "environment_observation_persistence" || context?.failureMode === "participant_page_count_contradiction" || context?.failureMode === "participant_page_duplicate_id" || context?.failureMode === "participant_registration_not_reconciled" || context?.failureMode === "participant_roster_mapping_unresolved" || context?.failureMode === "participant_mapping_persistence" || context?.failureMode === "participant_invitation_confirmation" || context?.failureMode === "sales_participant_correlation_properties_missing" || context?.failureMode === "participant_legacy_backfill_ambiguous" ? context.failureMode : oauthFailure ? status === undefined ? "transport_failure" : "http_failure" : "cloudshare_participants";
  const expectedCount = nonnegativeInteger(context?.expectedCount); const returnedCount = nonnegativeInteger(context?.returnedCount); const localParticipantCount = nonnegativeInteger(context?.localParticipantCount); const cloudShareParticipantCount = nonnegativeInteger(context?.cloudShareParticipantCount); const recoveredParticipantCount = nonnegativeInteger(context?.recoveredParticipantCount); const unmatchedCloudShareParticipantCount = nonnegativeInteger(context?.unmatchedCloudShareParticipantCount);
  return { failureMode, ...(oauthFailure && status !== undefined ? { status } : {}), ...(expectedCount === undefined ? {} : { expectedCount }), ...(returnedCount === undefined ? {} : { returnedCount }), ...(localParticipantCount === undefined ? {} : { localParticipantCount }), ...(cloudShareParticipantCount === undefined ? {} : { cloudShareParticipantCount }), ...(recoveredParticipantCount === undefined ? {} : { recoveredParticipantCount }), ...(unmatchedCloudShareParticipantCount === undefined ? {} : { unmatchedCloudShareParticipantCount }) };
}
function participantIntegrationSurface(error: unknown): string {
  const context = error instanceof Error && "context" in error ? (error as { context?: { path?: unknown; integrationSurface?: unknown } }).context : undefined;
  if (typeof context?.integrationSurface === "string") return context.integrationSurface;
  return typeof context?.path === "string" && context.path.includes("/envs") ? "cloudshare.v3.environments" : "cloudshare.v4.sales.participants";
}
function environmentObservationUnrecognized(read: Awaited<ReturnType<EnvironmentStateEvidenceSource["readEnvironmentState"]>>): CloudShareResponseError { return new CloudShareResponseError("CloudShare returned an unrecognized Environment status observation.", { method: typeof read.request.method === "string" ? read.request.method : "GET", path: typeof read.request.path === "string" ? read.request.path : "/envs", status: typeof read.response.status === "number" ? read.response.status : 200, responseStatus: typeof read.response.status === "number" ? read.response.status : 200, responseBody: read.response.body, requestHeaders: read.request.headers, responseHeaders: read.response.headers, failureMode: "environment_status_observation" }); }
function environmentResolutionFailed(error: SalesEnvironmentResolutionError): CloudShareResponseError {
  const exchange = error.exchanges.at(-1);
  return new CloudShareResponseError(error.message, { method: "GET", path: typeof exchange?.request.path === "string" ? exchange.request.path : "/envs", status: typeof exchange?.response.status === "number" ? exchange.response.status : 200, responseStatus: typeof exchange?.response.status === "number" ? exchange.response.status : 200, responseBody: exchange?.response.body, requestQuery: exchange?.request.query, requestHeaders: exchange?.request.headers, responseHeaders: exchange?.response.headers, failureMode: error.reason });
}
function salesEnvironmentObservationPersistenceFailed(error: unknown, exchange: { readonly request: Readonly<Record<string, unknown>>; readonly response: Readonly<Record<string, unknown>> }): CloudShareResponseError {
  return new CloudShareResponseError(`CloudShare Environment state was read but Certalis could not persist its observation: ${error instanceof Error ? error.message : String(error)}`, { method: typeof exchange.request.method === "string" ? exchange.request.method : "GET", path: typeof exchange.request.path === "string" ? exchange.request.path : "/envs/actions/getextended", status: typeof exchange.response.status === "number" ? exchange.response.status : 200, responseStatus: typeof exchange.response.status === "number" ? exchange.response.status : 200, responseBody: exchange.response.body, requestQuery: exchange.request.query, requestHeaders: exchange.request.headers, responseHeaders: exchange.response.headers, failureMode: "environment_observation_persistence" });
}
function environmentObservationPersistenceFailed(error: unknown, read: Awaited<ReturnType<EnvironmentStateEvidenceSource["readEnvironmentState"]>>): CloudShareResponseError { return new CloudShareResponseError(`CloudShare Environment state was read but Certalis could not persist its observation: ${error instanceof Error ? error.message : String(error)}`, { method: typeof read.request.method === "string" ? read.request.method : "GET", path: typeof read.request.path === "string" ? read.request.path : "/envs", status: typeof read.response.status === "number" ? read.response.status : 200, responseStatus: typeof read.response.status === "number" ? read.response.status : 200, responseBody: read.response.body, requestHeaders: read.request.headers, responseHeaders: read.response.headers, failureMode: "environment_observation_persistence" }); }
function nonnegativeInteger(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined; }
async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
function participantRegistrationNotReconciled(remote: SalesDeliveryEvidence, expectedCount: number, returnedCount: number): CloudShareResponseError { return new CloudShareResponseError("CloudShare accepted the participant registration but its authoritative roster did not return every selected Opportunity Contact.", { method: remote.request.method, path: remote.request.path, ...(remote.request.query ? { requestQuery: remote.request.query } : {}), ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}), ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}), status: remote.response.status, responseStatus: remote.response.status, ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}), responseBody: remote.response.body, expectedCount, returnedCount, failureMode: "participant_registration_not_reconciled" }); }
function participantLegacyBackfillAmbiguous(remote: SalesDeliveryEvidence, selectedContactCount: number): CloudShareResponseError { return new CloudShareResponseError("CloudShare has legacy Sales Participants that cannot be backfilled without an unambiguous one-to-one selected Opportunity Contact mapping.", { method: remote.request.method, path: remote.request.path, ...(remote.request.query ? { requestQuery: remote.request.query } : {}), ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}), ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}), status: remote.response.status, responseStatus: remote.response.status, ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}), responseBody: remote.response.body, expectedCount: selectedContactCount, returnedCount: 0, failureMode: "participant_legacy_backfill_ambiguous" }); }
function participantRosterMappingUnresolved(remote: SalesDeliveryEvidence, cloudShareParticipantCount: number, localParticipantCount: number, recoveredParticipantCount: number, unmatchedCloudShareParticipantCount: number): CloudShareResponseError { return new CloudShareResponseError("CloudShare returned Sales Participants that Certalis cannot safely associate with exactly one active Opportunity Contact.", { method: remote.request.method, path: remote.request.path, ...(remote.request.query ? { requestQuery: remote.request.query } : {}), ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}), ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}), status: remote.response.status, responseStatus: remote.response.status, ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}), responseBody: remote.response.body, localParticipantCount, cloudShareParticipantCount, recoveredParticipantCount, unmatchedCloudShareParticipantCount, failureMode: "participant_roster_mapping_unresolved" }); }
function hasParticipantFailureContext(error: unknown): boolean { return error instanceof Error && "context" in error && Boolean((error as { context?: unknown }).context); }
function participantMappingPersistenceFailed(error: unknown): Error & { readonly context: { readonly failureMode: "participant_mapping_persistence" } } { const failure = new Error(`Certalis could not persist or reconcile Sales Participant monitoring after CloudShare returned the roster: ${error instanceof Error ? error.message : String(error)}`) as Error & { context: { readonly failureMode: "participant_mapping_persistence" } }; failure.context = { failureMode: "participant_mapping_persistence" }; return failure; }
function participantInvitationConfirmationFailed(error: unknown): Error & { readonly context: { readonly failureMode: "participant_invitation_confirmation" } } { const failure = new Error(`CloudShare accepted the native invitation request, but Certalis could not confirm or persist its result: ${error instanceof Error ? error.message : String(error)}`) as Error & { context: { readonly failureMode: "participant_invitation_confirmation" } }; failure.context = { failureMode: "participant_invitation_confirmation" }; return failure; }
function groupByNormalizedEmail<T extends { readonly email: string }>(values: readonly T[]): Map<string, T[]> { const groups = new Map<string, T[]>(); for (const value of values) { const email = value.email.toLowerCase(); groups.set(email, [...(groups.get(email) ?? []), value]); } return groups; }
