import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import { createCloudShareSalesDelivery, type SalesDelivery, type SalesDeliveryEvidence } from "@/integrations/cloudshare/sales-delivery";
import { CloudShareResponseError } from "@/integrations/cloudshare/errors";

const contactsSchema = z.object({ contactIds: z.array(z.string().trim().min(1)).min(1).max(100) });
const participantIdsSchema = z.object({ participantIds: z.array(z.string().trim().min(1)).min(1).max(100) });
type Request = { readonly customerId: string; readonly sessionId: string; readonly actor: DiagnosticActor; readonly body?: unknown };
type Deps = { sessions: Pick<SalesDemoSessionRepository, "findById">; records: Pick<SalesRecordRepository, "findContact"> & Partial<Pick<SalesRecordRepository, "listContacts">>; participants: SalesSessionParticipantRepository; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare?: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "createSession" | "readSession"> & Partial<SalesDelivery> }; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write">; now?: () => Date };

/** Deep handler interface: contacts are resolved server-side before the typed
 * CloudShare adapter is crossed. Browser-provided emails and provider URLs are
 * never accepted or returned. */
export async function handleRegisterSalesSessionParticipants(deps: Deps, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = contactsSchema.safeParse(request.body); if (!parsed.success) return { status: 400, body: { error: "Select one or more Opportunity Contacts." } };
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
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
    completedExchanges.push(remoteBeforeRegistration);
    const persisted = await deps.participants.list(request.customerId, prepared.session.id);
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
    if (remoteAfterRegistration !== remoteBeforeRegistration) completedExchanges.push(remoteAfterRegistration);
    const participantByPortalId = new Map([...planned.values()].map((value) => [value.id, remoteAfterRegistration.participants.filter((participant) => participantProperties(participant).certalisSalesParticipantId === value.id && participantProperties(participant).certalisOpportunityContactId === value.contact.id)]));
    const remoteContactCounts = new Map<string, number>();
    for (const participant of remoteAfterRegistration.participants) { const contactId = participantProperties(participant).certalisOpportunityContactId; if (contactId) remoteContactCounts.set(contactId, (remoteContactCounts.get(contactId) ?? 0) + 1); }
    if (new Set([...planned.values()].map((value) => value.id)).size !== planned.size || [...participantByPortalId.values()].some((matches) => matches.length !== 1) || [...planned.values()].some((value) => remoteContactCounts.get(value.contact.id) !== 1)) throw participantRegistrationNotReconciled(remoteAfterRegistration, planned.size, 0);
    const now = new Date();
    const saved = await Promise.all(contacts.map(async (contact) => { const existing = persistedByContactId.get(contact.id); if (existing) return { value: existing, contact }; const plan = planned.get(contact.id)!; const participant = participantByPortalId.get(plan.id)![0]!; const value = { id: plan.id, customerId: request.customerId, salesDemoSessionId: prepared.session.id, opportunityContactId: contact.id, cloudShareParticipantId: participant.id, invitationStatus: participant.invitationStatus, lastInvitedAt: null, invitedBy: participant.invitedBy, participationStatus: participant.participationStatus, firstJoined: participant.firstJoined, cloudShareEnvironmentId: participant.environmentId, environmentStatus: participant.envStatus ?? null, lastReconciledAt: now, createdAt: now, updatedAt: now } as const; await deps.participants.save(value); return { value, contact }; }));
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.registered", "success", "Sales Participants registered with CloudShare", remoteAfterRegistration, { contactIds: parsed.data.contactIds, registeredParticipantCount: contactsNeedingRemoteRegistration.length, adoptedLegacyParticipantCount: legacyByContactId.size - persistedLegacyByContactId.size, repairedPersistedParticipantCount: persistedLegacyByContactId.size, httpExchanges: completedExchanges }, saved.length === 1 && saved[0]!.value.cloudShareEnvironmentId ? { environmentId: saved[0]!.value.cloudShareEnvironmentId } : {});
    return { status: 201, body: { participants: saved.map(({ value, contact }) => portalParticipant(value, contact)), correlationId } };
  } catch (error) { const classifiedError = completedRemote && !hasParticipantFailureContext(error) ? participantMappingPersistenceFailed(error) : error; const failedExchange = exchange(error); return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.registered", "CloudShare could not register selected Sales Participants.", classifiedError, completedRemote, [...completedExchanges, ...priorHttpExchanges(error), ...(failedExchange ? [failedExchange] : [])]); }
}

export async function handleInviteSalesSessionParticipants(deps: Deps, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = participantIdsSchema.safeParse(request.body); if (!parsed.success) return { status: 400, body: { error: "Select one or more registered Sales Participants." } };
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
  const invitationWindow = participantInvitationWindow(prepared.session, (deps.now ?? (() => new Date()))());
  if (!invitationWindow.nativeInvitationsAvailable) {
    const correlationId = randomUUID();
    const error = "Native invitations are unavailable after this Sales Session has ended.";
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", error, undefined, { failureMode: "sales_session_ended", participantIds: parsed.data.participantIds }, {}, false);
    return { status: 409, body: { code: "sales_session_ended", error, correlationId } };
  }
  const registered = await deps.participants.list(request.customerId, prepared.session.id);
  const selected = parsed.data.participantIds.map((id) => registered.find((participant) => participant.id === id));
  if (selected.some((participant) => !participant)) return denied(deps, request, prepared.session, 404, "Selected registered Sales Participant was not found for this Session.", "participant_not_found");
  const correlationId = randomUUID();
  let acknowledgedInvite: SalesDeliveryEvidence | undefined;
  const completedExchanges: Array<{ readonly request: unknown; readonly response: unknown }> = [];
  try {
    // CloudShare's invite endpoint acknowledges disabled invitations with an
    // empty 200. Read the documented Experience configuration first so
    // Certalis can return the actual prerequisite rather than a false success.
    const capability = await prepared.delivery.readParticipantInvitationCapability!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(capability);
    if (!capability.participantInvitationsEnabled) {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "CloudShare native invitations are disabled for this Sales Experience.", capability, { failureMode: "native_invitations_disabled", sendInvitations: capability.sendInvitations, participantIds: parsed.data.participantIds, httpExchanges: completedExchanges });
      return { status: 409, body: { code: "native_invitations_disabled", error: "CloudShare has native invitations disabled for this Sales Experience. Enable invitations in CloudShare before sending or resending.", correlationId } };
    }
    // A persisted mapping alone is not sufficient authority to resend an invite:
    // reconciliation may have already established that CloudShare no longer knows it.
    const current = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(current);
    const currentByProviderId = new Map(current.participants.map((participant) => [participant.id, participant]));
    if (selected.some((participant) => {
      const remote = currentByProviderId.get(participant!.cloudShareParticipantId);
      return !remote || participantProperties(remote).certalisSalesParticipantId !== participant!.id || participantProperties(remote).certalisOpportunityContactId !== participant!.opportunityContactId;
    })) {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "One or more selected Sales Participants no longer has its Certalis correlation values in CloudShare. Refresh monitoring and investigate the correlated diagnostics before inviting.", current, { failureMode: "participant_mapping_missing_from_cloudshare", participantIds: parsed.data.participantIds, httpExchanges: completedExchanges });
      return { status: 409, body: { error: "One or more selected Sales Participants need attention and cannot be invited. Refresh monitoring and investigate the correlated diagnostics.", correlationId } };
    }
    const requested = await prepared.delivery.inviteParticipants!(prepared.session.cloudShareSalesExperienceId, selected.map((participant) => participant!.cloudShareParticipantId));
    acknowledgedInvite = requested;
    completedExchanges.push(requested);
    // The documented endpoint acknowledges with an empty 200 response. Treat a
    // subsequent roster read as the only authority for the participant's
    // invitation state, rather than claiming that acknowledgement is delivery.
    const afterRequest = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedExchanges.push(afterRequest);
    const afterByProviderId = new Map(afterRequest.participants.map((participant) => [participant.id, participant]));
    const confirmed = selected.map((stored) => {
      const participant = afterByProviderId.get(stored!.cloudShareParticipantId);
      return participant && participantProperties(participant).certalisSalesParticipantId === stored!.id && participantProperties(participant).certalisOpportunityContactId === stored!.opportunityContactId
        ? { stored: stored!, before: currentByProviderId.get(stored!.cloudShareParticipantId)!, participant }
        : undefined;
    });
    if (confirmed.some((value) => !value)) {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "CloudShare accepted the native invitation request but did not return one or more selected Sales Participant mappings during confirmation.", requested, { failureMode: "participant_mapping_missing_from_cloudshare", participantIds: parsed.data.participantIds, httpExchanges: completedExchanges });
      return { status: 409, body: { error: "CloudShare could not confirm one or more selected Sales Participants after the invitation request. Refresh monitoring and investigate the correlated diagnostics before retrying.", correlationId } };
    }
    const confirmedParticipants = confirmed.filter((value): value is NonNullable<typeof value> => value !== undefined);
    const now = (deps.now ?? (() => new Date()))();
    await Promise.all(confirmedParticipants.map(({ stored, participant }) => deps.participants.save({ ...stored, cloudShareParticipantId: participant.id, invitationStatus: participant.invitationStatus, lastInvitedAt: participant.invitationStatus === "sent" ? now : stored.lastInvitedAt, invitedBy: participant.invitedBy, participationStatus: participant.participationStatus, firstJoined: participant.firstJoined, cloudShareEnvironmentId: participant.environmentId, environmentStatus: participant.envStatus ?? null, lastReconciledAt: now, updatedAt: now })));
    // The timestamp records this explicit request only after CloudShare has
    // acknowledged it and the authoritative follow-up roster confirms sent.
    const confirmedParticipantCount = confirmedParticipants.filter(({ before, participant }) => before.invitationStatus === "notSent" && participant.invitationStatus === "sent").length;
    const pendingConfirmationParticipantCount = confirmedParticipants.length - confirmedParticipantCount;
    const alreadySentParticipantCount = confirmedParticipants.filter(({ before, participant }) => before.invitationStatus === "sent" && participant.invitationStatus === "sent").length;
    const invitationConfirmation = pendingConfirmationParticipantCount === 0 ? "confirmed" : "pending";
    const message = invitationConfirmation === "confirmed"
      ? "CloudShare confirmed native invitations for selected Sales Participants."
      : "CloudShare accepted the native invitation request, but has not yet confirmed the invitation as sent.";
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "success", message, requested, { participantIds: parsed.data.participantIds, confirmedParticipantCount, pendingConfirmationParticipantCount, ...(alreadySentParticipantCount > 0 ? { alreadySentParticipantCount } : {}), httpExchanges: completedExchanges });
    return { status: 200, body: { correlationId, invitationConfirmation, confirmedParticipantCount, pendingConfirmationParticipantCount } };
  }
  catch (error) {
    const failedExchange = exchange(error);
    if (acknowledgedInvite) {
      return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "CloudShare accepted the native invitation request, but Certalis could not confirm or save its result. Do not retry until support diagnostics are reviewed.", participantInvitationConfirmationFailed(error), acknowledgedInvite, [...completedExchanges, ...priorHttpExchanges(error), ...(failedExchange ? [failedExchange] : [])]);
    }
    return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "CloudShare could not send the selected native invitations.", error, undefined, [...completedExchanges, ...priorHttpExchanges(error), ...(failedExchange ? [failedExchange] : [])]);
  }
}

export async function handleListSalesSessionParticipants(deps: Deps, request: Omit<Request, "body">): Promise<{ status: number; body: Record<string, unknown> }> {
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
  const correlationId = randomUUID();
  let completedRemote: Awaited<ReturnType<NonNullable<SalesDelivery["listParticipants"]>>> | undefined;
  try {
    const remote = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    completedRemote = remote;
    const local = await deps.participants.list(request.customerId, prepared.session.id);
    const now = new Date();
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
    const reconciled = await Promise.all(mappedParticipants.map(async (stored) => {
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
      if (participant) await deps.participants.save(current); else if (requiresCorrelationRepair) correlationRepairRequiredCount += 1; else missingCloudShareParticipantCount += 1;
      const contact = await deps.records.findContact(request.customerId, current.opportunityContactId);
      return { current, participant, contact, requiresCorrelationRepair };
    }));
    const projected = reconciled.map(({ current, participant, contact, requiresCorrelationRepair }) => contact ? portalParticipant(current, contact, participant ? undefined : requiresCorrelationRepair ? { needsAttention: true, requiresCorrelationRepair: true, monitoringMessage: "CloudShare returned this participant without its Certalis correlation properties. Select this Contact above to repair the mapping before inviting." } : { needsAttention: true, monitoringMessage: "CloudShare no longer returned this registered participant. Do not resend; investigate the correlated diagnostics." }) : null);
    const reconciliationFailed = missingCloudShareParticipantCount > 0 || correlationRepairRequiredCount > 0;
    const reconciliationMessage = correlationRepairRequiredCount > 0 && missingCloudShareParticipantCount === 0
      ? "CloudShare returned one or more Sales Participants without their Certalis correlation properties; select those Contacts to repair the mappings."
      : missingCloudShareParticipantCount > 0
        ? "CloudShare did not return one or more registered Sales Participants; those mappings need attention."
        : "Sales Participant monitoring state reconciled from CloudShare";
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.reconciled", reconciliationFailed ? "failure" : "success", reconciliationMessage, remote, { localParticipantCount: local.length, cloudShareParticipantCount: remote.participants.length, recoveredParticipantCount: recovery.recoveredParticipantCount, participantCount: reconciled.length, ...(missingCloudShareParticipantCount > 0 ? { missingCloudShareParticipantCount } : {}), ...(correlationRepairRequiredCount > 0 ? { correlationRepairRequiredCount } : {}) });
    // Keep each mapping independently searchable. `externalIds` is deliberately a
    // string map, so a multi-participant reconciliation cannot be represented by
    // putting an array there without breaking diagnostics lookup semantics.
    await Promise.all(reconciled.map(({ current, participant, requiresCorrelationRepair }) => evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.reconciled", participant ? "success" : "failure", participant ? "Sales Participant monitoring mapping reconciled from CloudShare" : requiresCorrelationRepair ? "CloudShare returned this Sales Participant but its Certalis correlation properties need repair." : "CloudShare no longer returned this registered Sales Participant mapping.", undefined, { portalParticipantId: current.id, opportunityContactId: current.opportunityContactId, ...(participant ? {} : { failureMode: requiresCorrelationRepair ? "participant_correlation_properties_missing" : "participant_mapping_missing_from_cloudshare" }) }, { cloudShareParticipantId: current.cloudShareParticipantId, ...(current.cloudShareEnvironmentId ? { environmentId: current.cloudShareEnvironmentId } : {}) })));
    const invitationWindow = participantInvitationWindow(prepared.session, (deps.now ?? (() => new Date()))());
    return { status: 200, body: { session: { id: prepared.session.id, start: prepared.session.start, end: prepared.session.end, timeZone: prepared.session.timeZone, lifecycle: invitationWindow.lifecycle, nativeInvitationsAvailable: invitationWindow.nativeInvitationsAvailable }, participants: projected.filter((participant): participant is NonNullable<typeof participant> => participant !== null), correlationId } }; }
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

function portalParticipant(value: import("@/domain/sales-session-participant").SalesSessionParticipant, contact: { readonly firstName: string; readonly lastName: string; readonly email: string }, reconciliation?: { readonly needsAttention: true; readonly requiresCorrelationRepair?: true; readonly monitoringMessage: string }) { return { id: value.id, opportunityContactId: value.opportunityContactId, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, invitationStatus: value.invitationStatus, lastInvitedAt: value.lastInvitedAt?.toISOString() ?? null, invitedBy: value.invitedBy, participationStatus: value.participationStatus, firstJoined: value.firstJoined, envStatus: value.environmentStatus, ...reconciliation }; }
function participantInvitationWindow(session: { readonly start: string; readonly end: string; readonly timeZone: string }, now: Date) { const start = cloudShareWallClockToInstant(session.start, session.timeZone); const end = cloudShareWallClockToInstant(session.end, session.timeZone); const lifecycle = !start || !end ? "needs_attention" as const : end <= now ? "ended" as const : start > now ? "upcoming" as const : "in_progress" as const; return { lifecycle, nativeInvitationsAvailable: lifecycle === "upcoming" || lifecycle === "in_progress" }; }
async function resolve(deps: Deps, request: Omit<Request, "body">) { if (!deps.sessions.findById) return { response: { status: 503, body: { error: "Sales Participant monitoring is unavailable." } } }; const [session, connection] = await Promise.all([deps.sessions.findById(request.customerId, request.sessionId), deps.connections.findByCustomerId(request.customerId)]); if (!session || !connection) return { response: { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } } }; if (session.operationalStatus !== "active" || session.cloudShareSalesExperienceId.startsWith("pending:")) return { response: { status: 409, body: { error: "Participants are available only after this Sales Session is provisioned." } } }; const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery(deps.cloudshare!.forConnection(connection)); return { session, delivery }; }
async function denied(deps: Deps, request: Request, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, status: number, error: string, failureMode: string) { const correlationId = randomUUID(); await evidence(deps, request, session, correlationId, "sales.demo_session.participants.registered", "failure", error, undefined, { failureMode }); return { status, body: { error, correlationId } }; }
async function failed(deps: Deps, request: Request, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, correlationId: string, operation: string, message: string, error: unknown, completedRemote?: { request: unknown; response: unknown }, httpExchanges: readonly { readonly request: unknown; readonly response: unknown }[] = []) { await evidence(deps, request, session, correlationId, operation, "failure", message, exchange(error) ?? completedRemote, { ...participantFailureDetails(error), error: error instanceof Error ? error.message : String(error), ...(httpExchanges.length > 0 ? { httpExchanges } : {}) }); return { status: 502, body: { error: message, correlationId } }; }
async function evidence(deps: Deps, request: Omit<Request, "body">, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, correlationId: string, operation: string, outcome: "success" | "failure", message: string, remote: { request: unknown; response: unknown } | undefined, details: Record<string, unknown>, externalIds: Record<string, string> = {}, includeProviderId = true) { const correlatedExternalIds = { opportunityId: session.opportunityId, ...(includeProviderId ? { cloudShareSalesExperienceId: session.cloudShareSalesExperienceId } : {}), ...externalIds }; await Promise.allSettled([deps.diagnostics?.record({ source: "sales-session-participants", operation, outcome, level: outcome === "success" ? "info" : "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, correlationId, message, externalIds: correlatedExternalIds, request: remote?.request as Record<string, unknown>, response: remote?.response as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales.participants", ...details } }), deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: operation, subjectType: "sales_demo_session", subjectId: session.id, outcome, correlationId, details: { ...correlatedExternalIds, ...details }, ...(outcome === "failure" ? { error: message } : {}) })]); }
function exchange(error: unknown) { if (!(error instanceof Error) || !("context" in error)) return undefined; const c = (error as { context?: Record<string, unknown> }).context; if (!c || typeof c.method !== "string" || typeof c.path !== "string") return undefined; return { request: { method: c.method, path: c.path, query: c.requestQuery, headers: c.requestHeaders, body: c.requestBody }, response: { status: c.responseStatus ?? c.status, headers: c.responseHeaders, body: c.responseBody, transport: c.cause } }; }
function priorHttpExchanges(error: unknown): readonly { readonly request: unknown; readonly response: unknown }[] { if (!(error instanceof Error) || !("context" in error)) return []; const exchanges = (error as { context?: { priorHttpExchanges?: unknown } }).context?.priorHttpExchanges; return Array.isArray(exchanges) ? exchanges.filter((value): value is { readonly request: unknown; readonly response: unknown } => Boolean(value && typeof value === "object" && "request" in value && "response" in value)) : []; }
type ParticipantFailureMode = "cloudshare_participants" | "participant_page_count_contradiction" | "participant_page_duplicate_id" | "participant_registration_not_reconciled" | "participant_roster_mapping_unresolved" | "participant_mapping_persistence" | "participant_invitation_confirmation" | "sales_participant_correlation_properties_missing" | "participant_legacy_backfill_ambiguous";
function participantFailureDetails(error: unknown): { readonly failureMode: ParticipantFailureMode; readonly expectedCount?: number; readonly returnedCount?: number; readonly localParticipantCount?: number; readonly cloudShareParticipantCount?: number; readonly recoveredParticipantCount?: number; readonly unmatchedCloudShareParticipantCount?: number } { const context = error instanceof Error && "context" in error ? (error as { context?: Record<string, unknown> }).context : undefined; const failureMode: ParticipantFailureMode = context?.failureMode === "participant_page_count_contradiction" || context?.failureMode === "participant_page_duplicate_id" || context?.failureMode === "participant_registration_not_reconciled" || context?.failureMode === "participant_roster_mapping_unresolved" || context?.failureMode === "participant_mapping_persistence" || context?.failureMode === "participant_invitation_confirmation" || context?.failureMode === "sales_participant_correlation_properties_missing" || context?.failureMode === "participant_legacy_backfill_ambiguous" ? context.failureMode : "cloudshare_participants"; const expectedCount = nonnegativeInteger(context?.expectedCount); const returnedCount = nonnegativeInteger(context?.returnedCount); const localParticipantCount = nonnegativeInteger(context?.localParticipantCount); const cloudShareParticipantCount = nonnegativeInteger(context?.cloudShareParticipantCount); const recoveredParticipantCount = nonnegativeInteger(context?.recoveredParticipantCount); const unmatchedCloudShareParticipantCount = nonnegativeInteger(context?.unmatchedCloudShareParticipantCount); return { failureMode, ...(expectedCount === undefined ? {} : { expectedCount }), ...(returnedCount === undefined ? {} : { returnedCount }), ...(localParticipantCount === undefined ? {} : { localParticipantCount }), ...(cloudShareParticipantCount === undefined ? {} : { cloudShareParticipantCount }), ...(recoveredParticipantCount === undefined ? {} : { recoveredParticipantCount }), ...(unmatchedCloudShareParticipantCount === undefined ? {} : { unmatchedCloudShareParticipantCount }) }; }
function nonnegativeInteger(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined; }
function participantRegistrationNotReconciled(remote: SalesDeliveryEvidence, expectedCount: number, returnedCount: number): CloudShareResponseError { return new CloudShareResponseError("CloudShare accepted the participant registration but its authoritative roster did not return every selected Opportunity Contact.", { method: remote.request.method, path: remote.request.path, ...(remote.request.query ? { requestQuery: remote.request.query } : {}), ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}), ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}), status: remote.response.status, responseStatus: remote.response.status, ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}), responseBody: remote.response.body, expectedCount, returnedCount, failureMode: "participant_registration_not_reconciled" }); }
function participantLegacyBackfillAmbiguous(remote: SalesDeliveryEvidence, selectedContactCount: number): CloudShareResponseError { return new CloudShareResponseError("CloudShare has legacy Sales Participants that cannot be backfilled without an unambiguous one-to-one selected Opportunity Contact mapping.", { method: remote.request.method, path: remote.request.path, ...(remote.request.query ? { requestQuery: remote.request.query } : {}), ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}), ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}), status: remote.response.status, responseStatus: remote.response.status, ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}), responseBody: remote.response.body, expectedCount: selectedContactCount, returnedCount: 0, failureMode: "participant_legacy_backfill_ambiguous" }); }
function participantRosterMappingUnresolved(remote: SalesDeliveryEvidence, cloudShareParticipantCount: number, localParticipantCount: number, recoveredParticipantCount: number, unmatchedCloudShareParticipantCount: number): CloudShareResponseError { return new CloudShareResponseError("CloudShare returned Sales Participants that Certalis cannot safely associate with exactly one active Opportunity Contact.", { method: remote.request.method, path: remote.request.path, ...(remote.request.query ? { requestQuery: remote.request.query } : {}), ...(remote.request.headers ? { requestHeaders: remote.request.headers } : {}), ...(remote.request.body !== undefined ? { requestBody: remote.request.body } : {}), status: remote.response.status, responseStatus: remote.response.status, ...(remote.response.headers ? { responseHeaders: remote.response.headers } : {}), responseBody: remote.response.body, localParticipantCount, cloudShareParticipantCount, recoveredParticipantCount, unmatchedCloudShareParticipantCount, failureMode: "participant_roster_mapping_unresolved" }); }
function hasParticipantFailureContext(error: unknown): boolean { return error instanceof Error && "context" in error && Boolean((error as { context?: unknown }).context); }
function participantMappingPersistenceFailed(error: unknown): Error & { readonly context: { readonly failureMode: "participant_mapping_persistence" } } { const failure = new Error(`Certalis could not persist or reconcile Sales Participant monitoring after CloudShare returned the roster: ${error instanceof Error ? error.message : String(error)}`) as Error & { context: { readonly failureMode: "participant_mapping_persistence" } }; failure.context = { failureMode: "participant_mapping_persistence" }; return failure; }
function participantInvitationConfirmationFailed(error: unknown): Error & { readonly context: { readonly failureMode: "participant_invitation_confirmation" } } { const failure = new Error(`CloudShare accepted the native invitation request, but Certalis could not confirm or persist its result: ${error instanceof Error ? error.message : String(error)}`) as Error & { context: { readonly failureMode: "participant_invitation_confirmation" } }; failure.context = { failureMode: "participant_invitation_confirmation" }; return failure; }
function groupByNormalizedEmail<T extends { readonly email: string }>(values: readonly T[]): Map<string, T[]> { const groups = new Map<string, T[]>(); for (const value of values) { const email = value.email.toLowerCase(); groups.set(email, [...(groups.get(email) ?? []), value]); } return groups; }
