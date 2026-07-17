import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";
import type { SalesSessionParticipantRepository } from "@/domain/sales-session-participant";
import { createCloudShareSalesDelivery, type SalesDelivery } from "@/integrations/cloudshare/sales-delivery";

const contactsSchema = z.object({ contactIds: z.array(z.string().trim().min(1)).min(1).max(100) });
const participantIdsSchema = z.object({ participantIds: z.array(z.string().trim().min(1)).min(1).max(100) });
type Request = { readonly customerId: string; readonly sessionId: string; readonly actor: DiagnosticActor; readonly body?: unknown };
type Deps = { sessions: Pick<SalesDemoSessionRepository, "findById">; records: Pick<SalesRecordRepository, "findContact">; participants: SalesSessionParticipantRepository; connections: Pick<CloudShareConnectionRepository, "findByCustomerId">; cloudshare?: Pick<CloudShareClientFactory, "forConnection">; deliveryFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): Pick<SalesDelivery, "createSession" | "readSession"> & Partial<SalesDelivery> }; diagnostics?: DiagnosticRecorder; audit?: Pick<AuditRepository, "write"> };

/** Deep handler interface: contacts are resolved server-side before the typed
 * CloudShare adapter is crossed. Browser-provided emails and provider URLs are
 * never accepted or returned. */
export async function handleRegisterSalesSessionParticipants(deps: Deps, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = contactsSchema.safeParse(request.body); if (!parsed.success) return { status: 400, body: { error: "Select one or more Opportunity Contacts." } };
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
  const contacts = await Promise.all(parsed.data.contactIds.map((id) => deps.records.findContact(request.customerId, id)));
  if (contacts.some((contact) => !contact || contact.opportunityId !== prepared.session.opportunityId || contact.archivedAt)) return denied(deps, request, prepared.session, 404, "Selected Opportunity Contact was not found for this Session.", "contact_not_found");
  const correlationId = randomUUID();
  try {
    // Recover a prior accepted CloudShare registration before issuing another
    // mutation. This makes a retry after a local persistence outage repair the
    // Contact-to-participant mapping instead of creating a second remote user.
    const [persisted, remoteBeforeRegistration] = await Promise.all([
      deps.participants.list(request.customerId, prepared.session.id),
      prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId),
    ]);
    const persistedContactIds = new Set(persisted.map((participant) => participant.opportunityContactId));
    const remoteByEmail = new Map(remoteBeforeRegistration.participants.map((participant) => [participant.email.toLowerCase(), participant]));
    const contactsNeedingRemoteRegistration = contacts.filter((contact) => !persistedContactIds.has(contact!.id) && !remoteByEmail.has(contact!.email.toLowerCase()));
    const created = contactsNeedingRemoteRegistration.length
      ? await prepared.delivery.registerParticipants!(prepared.session.cloudShareSalesExperienceId, contactsNeedingRemoteRegistration.map((contact) => ({ firstName: contact!.firstName, lastName: contact!.lastName, email: contact!.email })))
      : { participants: [], request: remoteBeforeRegistration.request, response: remoteBeforeRegistration.response };
    const remoteParticipants = [...remoteBeforeRegistration.participants, ...created.participants];
    const now = new Date();
    const saved = await Promise.all(contacts.map(async (contact) => { const existing = persisted.find((participant) => participant.opportunityContactId === contact!.id); if (existing) return { value: existing, contact: contact! }; const participant = remoteParticipants.find((candidate) => candidate.email.toLowerCase() === contact!.email.toLowerCase()); if (!participant) throw new Error("CloudShare did not return a participant that can be correlated to the selected Opportunity Contact."); const value = { id: randomUUID(), customerId: request.customerId, salesDemoSessionId: prepared.session.id, opportunityContactId: contact!.id, cloudShareParticipantId: participant.id, invitationStatus: participant.invitationStatus, invitedBy: participant.invitedBy, participationStatus: participant.participationStatus, firstJoined: participant.firstJoined, cloudShareEnvironmentId: participant.environmentId, environmentStatus: participant.envStatus ?? null, lastReconciledAt: now, createdAt: now, updatedAt: now } as const; await deps.participants.save(value); return { value, contact: contact! }; }));
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.registered", "success", "Sales Participants registered with CloudShare", created, { contactIds: parsed.data.contactIds, cloudShareParticipantIds: created.participants.map((participant) => participant.id), recoveredParticipantCount: remoteBeforeRegistration.participants.filter((participant) => contacts.some((contact) => contact!.email.toLowerCase() === participant.email.toLowerCase())).length }, saved.length === 1 && saved[0]!.value.cloudShareEnvironmentId ? { environmentId: saved[0]!.value.cloudShareEnvironmentId } : {});
    return { status: 201, body: { participants: saved.map(({ value, contact }) => portalParticipant(value, contact)), correlationId } };
  } catch (error) { return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.registered", "CloudShare could not register selected Sales Participants.", error); }
}

export async function handleInviteSalesSessionParticipants(deps: Deps, request: Request): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = participantIdsSchema.safeParse(request.body); if (!parsed.success) return { status: 400, body: { error: "Select one or more registered Sales Participants." } };
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
  const registered = await deps.participants.list(request.customerId, prepared.session.id);
  const selected = parsed.data.participantIds.map((id) => registered.find((participant) => participant.id === id));
  if (selected.some((participant) => !participant)) return denied(deps, request, prepared.session, 404, "Selected registered Sales Participant was not found for this Session.", "participant_not_found");
  const correlationId = randomUUID();
  try {
    // A persisted mapping alone is not sufficient authority to resend an invite:
    // reconciliation may have already established that CloudShare no longer knows it.
    const current = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId);
    const currentIds = new Set(current.participants.map((participant) => participant.id));
    if (selected.some((participant) => !currentIds.has(participant!.cloudShareParticipantId))) {
      await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "failure", "One or more selected Sales Participants are no longer returned by CloudShare. Refresh monitoring and investigate the correlated diagnostics before inviting.", current, { failureMode: "participant_mapping_missing_from_cloudshare", participantIds: parsed.data.participantIds });
      return { status: 409, body: { error: "One or more selected Sales Participants need attention and cannot be invited. Refresh monitoring and investigate the correlated diagnostics.", correlationId } };
    }
    const remote = await prepared.delivery.inviteParticipants!(prepared.session.cloudShareSalesExperienceId, selected.map((participant) => participant!.cloudShareParticipantId));
    await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "success", "Native CloudShare invitation requested for selected Sales Participants", remote, { participantIds: parsed.data.participantIds });
    return { status: 200, body: { correlationId } };
  }
  catch (error) { return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.invited", "CloudShare could not send the selected native invitations.", error); }
}

export async function handleListSalesSessionParticipants(deps: Deps, request: Omit<Request, "body">): Promise<{ status: number; body: Record<string, unknown> }> {
  const prepared = await resolve(deps, request); if ("response" in prepared) return prepared.response!;
  const correlationId = randomUUID();
  try { const remote = await prepared.delivery.listParticipants!(prepared.session.cloudShareSalesExperienceId); const local = await deps.participants.list(request.customerId, prepared.session.id); const now = new Date(); let missingCloudShareParticipantCount = 0; const reconciled = await Promise.all(local.map(async (stored) => { const participant = remote.participants.find((value) => value.id === stored.cloudShareParticipantId); const current = participant ? { ...stored, invitationStatus: participant.invitationStatus, invitedBy: participant.invitedBy, participationStatus: participant.participationStatus, firstJoined: participant.firstJoined, cloudShareEnvironmentId: participant.environmentId, environmentStatus: participant.envStatus ?? null, lastReconciledAt: now, updatedAt: now } : stored; if (participant) await deps.participants.save(current); else missingCloudShareParticipantCount += 1; const contact = await deps.records.findContact(request.customerId, current.opportunityContactId); return { current, participant, contact }; })); const projected = reconciled.map(({ current, participant, contact }) => contact ? portalParticipant(current, contact, participant ? undefined : { needsAttention: true, monitoringMessage: "CloudShare no longer returned this registered participant. Do not resend; investigate the correlated diagnostics." }) : null); const reconciliationFailed = missingCloudShareParticipantCount > 0; await evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participants.reconciled", reconciliationFailed ? "failure" : "success", reconciliationFailed ? "CloudShare did not return one or more registered Sales Participants; those mappings need attention." : "Sales Participant monitoring state reconciled from CloudShare", remote, { participantCount: local.length, ...(reconciliationFailed ? { missingCloudShareParticipantCount } : {}) });
    // Keep each mapping independently searchable. `externalIds` is deliberately a
    // string map, so a multi-participant reconciliation cannot be represented by
    // putting an array there without breaking diagnostics lookup semantics.
    await Promise.all(reconciled.map(({ current, participant }) => evidence(deps, request, prepared.session, correlationId, "sales.demo_session.participant.reconciled", participant ? "success" : "failure", participant ? "Sales Participant monitoring mapping reconciled from CloudShare" : "CloudShare no longer returned this registered Sales Participant mapping.", undefined, { portalParticipantId: current.id, opportunityContactId: current.opportunityContactId, ...(participant ? {} : { failureMode: "participant_mapping_missing_from_cloudshare" }) }, { cloudShareParticipantId: current.cloudShareParticipantId, ...(current.cloudShareEnvironmentId ? { environmentId: current.cloudShareEnvironmentId } : {}) }))); return { status: 200, body: { session: { id: prepared.session.id, start: prepared.session.start, end: prepared.session.end, timeZone: prepared.session.timeZone }, participants: projected.filter((participant): participant is NonNullable<typeof participant> => participant !== null), correlationId } }; }
  catch (error) { return failed(deps, request, prepared.session, correlationId, "sales.demo_session.participants.reconciled", "CloudShare could not reconcile Sales Participant monitoring.", error); }
}
function portalParticipant(value: import("@/domain/sales-session-participant").SalesSessionParticipant, contact: { readonly firstName: string; readonly lastName: string }, reconciliation?: { readonly needsAttention: true; readonly monitoringMessage: string }) { return { id: value.id, opportunityContactId: value.opportunityContactId, firstName: contact.firstName, lastName: contact.lastName, invitationStatus: value.invitationStatus, invitedBy: value.invitedBy, participationStatus: value.participationStatus, firstJoined: value.firstJoined, envStatus: value.environmentStatus, ...reconciliation }; }
async function resolve(deps: Deps, request: Omit<Request, "body">) { if (!deps.sessions.findById) return { response: { status: 503, body: { error: "Sales Participant monitoring is unavailable." } } }; const [session, connection] = await Promise.all([deps.sessions.findById(request.customerId, request.sessionId), deps.connections.findByCustomerId(request.customerId)]); if (!session || !connection) return { response: { status: 404, body: { error: "Sales Session or CloudShare Connection was not found." } } }; if (session.operationalStatus !== "active" || session.cloudShareSalesExperienceId.startsWith("pending:")) return { response: { status: 409, body: { error: "Participants are available only after this Sales Session is provisioned." } } }; const delivery = deps.deliveryFactory?.forConnection(connection) ?? createCloudShareSalesDelivery(deps.cloudshare!.forConnection(connection)); return { session, delivery }; }
async function denied(deps: Deps, request: Request, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, status: number, error: string, failureMode: string) { const correlationId = randomUUID(); await evidence(deps, request, session, correlationId, "sales.demo_session.participants.registered", "failure", error, undefined, { failureMode }); return { status, body: { error, correlationId } }; }
async function failed(deps: Deps, request: Request, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, correlationId: string, operation: string, message: string, error: unknown) { await evidence(deps, request, session, correlationId, operation, "failure", message, exchange(error), { failureMode: "cloudshare_participants", error: error instanceof Error ? error.message : String(error) }); return { status: 502, body: { error: message, correlationId } }; }
async function evidence(deps: Deps, request: Omit<Request, "body">, session: NonNullable<Awaited<ReturnType<NonNullable<Deps["sessions"]["findById"]>>>>, correlationId: string, operation: string, outcome: "success" | "failure", message: string, remote: { request: unknown; response: unknown } | undefined, details: Record<string, unknown>, externalIds: Record<string, string> = {}) { const correlatedExternalIds = { opportunityId: session.opportunityId, cloudShareSalesExperienceId: session.cloudShareSalesExperienceId, ...externalIds }; await Promise.allSettled([deps.diagnostics?.record({ source: "sales-session-participants", operation, outcome, level: outcome === "success" ? "info" : "warn", customerId: request.customerId, actor: request.actor, subject: { type: "sales_demo_session", id: session.id }, correlationId, message, externalIds: correlatedExternalIds, request: remote?.request as Record<string, unknown>, response: remote?.response as Record<string, unknown>, details: { integrationSurface: "cloudshare.v4.sales.participants", ...details } }), deps.audit?.write({ id: randomUUID(), occurredAt: new Date(), customerId: request.customerId, actorType: request.actor.type, actorId: request.actor.id, actorEmail: request.actor.email, action: operation, subjectType: "sales_demo_session", subjectId: session.id, outcome, correlationId, details: { ...correlatedExternalIds, ...details }, ...(outcome === "failure" ? { error: message } : {}) })]); }
function exchange(error: unknown) { if (!(error instanceof Error) || !("context" in error)) return undefined; const c = (error as { context?: Record<string, unknown> }).context; return c ? { request: { method: c.method, path: c.path, headers: c.requestHeaders, body: c.requestBody }, response: { status: c.responseStatus ?? c.status, headers: c.responseHeaders, body: c.responseBody, transport: c.cause } } : undefined; }
