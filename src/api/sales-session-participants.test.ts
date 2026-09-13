import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CloudShareAuthError, CloudShareResponseError } from "@/integrations/cloudshare/errors";
import { handleInviteSalesSessionParticipants as inviteSalesSessionParticipants, handleListSalesSessionParticipants as listSalesSessionParticipants, handleRegisterSalesSessionParticipants as registerSalesSessionParticipants } from "./sales-session-participants";
import { SalesEnvironmentResolutionError } from "@/integrations/cloudshare/sales-environment";
import { invitationResult, type SalesParticipantInvitationLedger } from "@/domain/sales-participant-invitation-ledger";

const fixedNow = () => new Date("2026-07-19T08:00:00.000Z");
const handleRegisterSalesSessionParticipants: typeof registerSalesSessionParticipants = (deps, request) => registerSalesSessionParticipants({ now: fixedNow, ...deps }, request);
const handleListSalesSessionParticipants: typeof listSalesSessionParticipants = (deps, request) => listSalesSessionParticipants({ now: fixedNow, ...deps }, request);
type StoredParticipantFixture = Omit<ReturnType<typeof storedParticipant>, "invitationStatus"> & { readonly invitationStatus: "notSent" | "sent" };
const explicitInviteBody = (participant: StoredParticipantFixture, intent: "invite" | "resend" = "invite", commandId = randomUUID()) => ({ commandId, targets: [{ participantId: participant.id, intent, expectedInvitationStatus: intent === "invite" ? "notSent" as const : "sent" as const, participantRevision: participant.updatedAt.toISOString() }] });
const handleInviteSalesSessionParticipants = (deps: Omit<Parameters<typeof inviteSalesSessionParticipants>[0], "invitationLedger"> & { invitationLedger?: SalesParticipantInvitationLedger }, request: Parameters<typeof inviteSalesSessionParticipants>[1]) => {
  if (deps.invitationLedger) return inviteSalesSessionParticipants({ now: fixedNow, ...deps, invitationLedger: deps.invitationLedger } as Parameters<typeof inviteSalesSessionParticipants>[0], request);
  const invitationLedger: SalesParticipantInvitationLedger = {
    admitBatch: vi.fn(async ({ commandId }) => ({ kind: "admitted" as const, commandId, admissionToken: "test-admission-token" })),
    markBatchDispatching: vi.fn(async (customerId, commandId) => ({ customerId, commandId, phase: "dispatching" as const, revision: 2, correlationId: null })),
    markBatchEvaluatingConfirmation: vi.fn(async ({ customerId, commandId, correlationId }) => ({ customerId, commandId, phase: "evaluating_confirmation" as const, revision: 3, correlationId })),
    expireAdmitted: vi.fn(async (customerId, commandId) => ({ customerId, commandId, phase: "settled" as const, revision: 2, correlationId: null })),
    failAdmitted: vi.fn(async (customerId, commandId) => ({ customerId, commandId, phase: "settled" as const, revision: 2, correlationId: null })),
    finishBatch: vi.fn(async ({ customerId, commandId, phase, correlationId }) => ({ customerId, commandId, phase, revision: 3, correlationId })),
    finishBatchWithParticipantProjections: vi.fn(async ({ customerId, commandId, phase, correlationId }) => ({ customerId, commandId, phase, revision: 3, correlationId })),
    readCommand: vi.fn(async () => null),
    readCurrent: vi.fn(async () => null),
  };
  return inviteSalesSessionParticipants({ now: fixedNow, ...deps, invitationLedger } as Parameters<typeof inviteSalesSessionParticipants>[0], request);
};

const actor = { type: "admin" as const, id: "admin-1", email: "sales-admin@certalis.demo" };
const session = { id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" as const, start: "2026-07-19T09:00", end: "2026-07-19T10:00", timeZone: "UTC" };
const contact = { id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null };
const correlationProperties = () => ({
  requiredKeys: ["certalisSalesParticipantId", "certalisOpportunityContactId"] as const,
  availableKeys: ["certalisSalesParticipantId", "certalisOpportunityContactId"],
  requests: [{ method: "GET", path: "/v4/sales/remote-sales-1/users/properties" }],
  responses: [{ status: 200, body: [] }],
  request: { method: "GET", path: "/v4/sales/remote-sales-1/users/properties" },
  response: { status: 200, body: [] },
});
const invitationEnabledEvidence = () => ({
  id: "remote-sales-1",
  participantInvitationsEnabled: true,
  sendInvitations: "salesProsAndParticipants" as const,
  request: { method: "GET", path: "/v4/sales/remote-sales-1" },
  response: { status: 200, body: { id: "remote-sales-1", sendInvitations: "salesProsAndParticipants" } },
});
const rosterEvidence = (participants: readonly unknown[]) => ({ completeness: "complete" as const, participants, request: { method: "GET", path: "/v4/sales/remote-sales-1/participants", query: { offset: "0", limit: "100" } }, response: { status: 200, body: { count: participants.length, items: participants } } });
const remoteParticipant = (id: string, portalId?: string, contactId?: string, email = "ada@example.test") => ({
  id, firstName: "Ada", lastName: "Lovelace", email, invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, environmentId: null, envStatus: null,
  customProperties: portalId && contactId ? { certalisSalesParticipantId: portalId, certalisOpportunityContactId: contactId } : {},
});
const storedParticipant = (id = "portal-1", contactId = "contact-1", cloudShareParticipantId = "remote-1") => ({ id, customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: contactId, cloudShareParticipantId, invitationStatus: "notSent" as const, lastInvitedAt: null as Date | null, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, cloudShareEnvironmentId: null, environmentStatus: null, lastReconciledAt: new Date("2026-07-17T08:00:00.000Z"), createdAt: new Date("2026-07-17T08:00:00.000Z"), updatedAt: new Date("2026-07-17T08:00:00.000Z") });

describe("Sales Session participant invitation", () => {
  it("blocks participant registration at the exact session end before integration setup", async () => {
    const findByCustomerId = vi.fn(() => { throw new Error("connection lookup must not run"); });
    const forConnection = vi.fn(() => { throw new Error("adapter construction must not run"); });
    const diagnostics = { record: vi.fn() };
    const result = await handleRegisterSalesSessionParticipants({ now: () => new Date("2026-07-17T10:00:00.000Z"), sessions: { findById: vi.fn().mockResolvedValue({ ...session, start: "2026-07-17T10:00", end: "2026-07-17T11:00", timeZone: "GMT Standard Time" }) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId }, deliveryFactory: { forConnection }, diagnostics }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: ["contact-1"] } });
    expect(result).toMatchObject({ status: 409, body: { code: "sales_session_ended", error: "Participant registration and repair are unavailable after this Sales Session has ended.", correlationId: expect.any(String) } });
    expect(findByCustomerId).not.toHaveBeenCalled(); expect(forConnection).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.participants.registered", details: expect.objectContaining({ failureMode: "sales_session_ended", contactIds: ["contact-1"] }) }));
  });
  it("rejects mixed new and concluded repair contacts atomically before integration setup", async () => {
    const findByCustomerId = vi.fn(() => { throw new Error("connection lookup must not run"); });
    const forConnection = vi.fn(() => { throw new Error("adapter construction must not run"); });
    const findContact = vi.fn(() => { throw new Error("contact lookup must not run"); });
    const diagnostics = { record: vi.fn() };
    const result = await handleRegisterSalesSessionParticipants({
      now: () => new Date("2026-07-19T09:30:00.000Z"), sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact },
      participants: { list: vi.fn().mockResolvedValue([{ ...storedParticipant("concluded", "contact-concluded", "provider-secret"), participationStatus: "concluded" }]), save: vi.fn() },
      connections: { findByCustomerId }, deliveryFactory: { forConnection }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: ["contact-new", "contact-concluded"] } });
    expect(result).toMatchObject({ status: 409, body: { code: "sales_participant_concluded", error: "Concluded Sales Participants cannot be registered or repaired.", correlationId: expect.any(String) } });
    expect(findContact).not.toHaveBeenCalled(); expect(findByCustomerId).not.toHaveBeenCalled(); expect(forConnection).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", subject: { type: "sales_demo_session", id: "session-1" }, details: expect.objectContaining({ failureMode: "sales_participant_concluded", contactIds: ["contact-new", "contact-concluded"] }) }));
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain("provider-secret");
  });
  it("blocks an invite at the exact persisted session end without calling CloudShare", async () => {
    const readParticipantInvitationCapability = vi.fn();
    const listParticipants = vi.fn();
    const inviteParticipants = vi.fn();
    const findByCustomerId = vi.fn(() => { throw new Error("connection lookup must not run"); });
    const forConnection = vi.fn(() => { throw new Error("adapter construction must not run"); });
    const diagnostics = { record: vi.fn() };
    const audit = { write: vi.fn() };

    const result = await handleInviteSalesSessionParticipants({
      now: () => new Date("2026-07-17T10:00:00.000Z"),
      sessions: { findById: vi.fn().mockResolvedValue({ ...session, start: "2026-07-17T09:00", end: "2026-07-17T10:00" }) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId },
      deliveryFactory: { forConnection }, diagnostics, audit,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result).toMatchObject({ status: 409, body: { code: "sales_session_ended", error: "Native invitations are unavailable after this Sales Session has ended.", correlationId: expect.any(String) } });
    expect(readParticipantInvitationCapability).not.toHaveBeenCalled();
    expect(listParticipants).not.toHaveBeenCalled();
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(findByCustomerId).not.toHaveBeenCalled();
    expect(forConnection).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.participants.invited", customerId: "customer-1", subject: { type: "sales_demo_session", id: "session-1" }, details: expect.objectContaining({ failureMode: "sales_session_ended", participantIds: ["portal-1"] }) }));
    expect(JSON.stringify(diagnostics.record.mock.calls)).not.toContain("remote-sales-1");
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", subjectId: "session-1", outcome: "failure", details: expect.objectContaining({ participantIds: ["portal-1"] }) }));
  });

  it("allows an upcoming Sales Session to proceed to native invitation checks", async () => {
    const capability = invitationEnabledEvidence();
    const readParticipantInvitationCapability = vi.fn().mockResolvedValue(capability);
    const roster = rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")]);
    const result = await handleInviteSalesSessionParticipants({
      now: () => new Date("2026-07-17T08:00:00.000Z"),
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability, listParticipants: vi.fn().mockResolvedValue(roster), inviteParticipants: vi.fn().mockResolvedValue({ request: { method: "POST", path: "/invite" }, response: { status: 200 } }) }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result.status).toBe(202);
    expect(readParticipantInvitationCapability).toHaveBeenCalledOnce();
  });
  it("rejects a mixed concluded and eligible invite atomically before CloudShare", async () => {
    const readParticipantInvitationCapability = vi.fn(); const listParticipants = vi.fn(); const inviteParticipants = vi.fn(); const forConnection = vi.fn();
    const result = await handleInviteSalesSessionParticipants({ now: () => new Date("2026-07-19T09:30:00.000Z"), sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant("eligible"), { ...storedParticipant("concluded", "contact-2", "remote-2"), participationStatus: "concluded" }]), save: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: { ...explicitInviteBody(storedParticipant("eligible")), targets: [explicitInviteBody(storedParticipant("eligible")).targets[0], { participantId: "concluded", intent: "invite", expectedInvitationStatus: "notSent", participantRevision: storedParticipant("concluded", "contact-2", "remote-2").updatedAt.toISOString() }] } });
    expect(result).toMatchObject({ status: 409, body: { code: "sales_participant_concluded", error: "Concluded Sales Participants cannot receive native invitations.", correlationId: expect.any(String) } });
    expect(forConnection).not.toHaveBeenCalled(); expect(readParticipantInvitationCapability).not.toHaveBeenCalled(); expect(listParticipants).not.toHaveBeenCalled(); expect(inviteParticipants).not.toHaveBeenCalled();
  });
  it("creates the documented property definitions and persists the authoritative property-bearing roster", async () => {
    const registered: Array<{ readonly customProperties: readonly { readonly name: string; readonly value: string }[] }> = [];
    const registerParticipants = vi.fn().mockImplementation(async (_salesId, participants) => { registered.push(...participants); return { request: { method: "POST", path: "/v4/sales/remote-sales-1/participants", body: participants }, response: { status: 201 } }; });
    const listParticipants = vi.fn().mockImplementation(async () => rosterEvidence(registered.map((value, index) => remoteParticipant(`remote-${index + 1}`, value.customProperties.find((property) => property.name === "certalisSalesParticipantId")?.value, value.customProperties.find((property) => property.name === "certalisOpportunityContactId")?.value))));
    const save = vi.fn();
    const diagnostics = { record: vi.fn() };
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-1")]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue(correlationProperties()), registerParticipants, listParticipants, inviteParticipants: vi.fn() }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result).toMatchObject({ status: 201, body: { participants: [{ opportunityContactId: contact.id }] } });
    expect(registerParticipants).toHaveBeenCalledWith("remote-sales-1", [expect.objectContaining({ customProperties: expect.arrayContaining([{ name: "certalisOpportunityContactId", value: contact.id }]) })]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ cloudShareParticipantId: "remote-1", opportunityContactId: contact.id }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.participants.registered", details: expect.objectContaining({ httpExchanges: expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) }), expect.objectContaining({ request: expect.objectContaining({ method: "POST" }) })]) }) }));
    expect(JSON.stringify(result.body)).not.toContain("remote-1");
  });

  it("uses properties rather than email when CloudShare returns a renamed participant", async () => {
    const participant = remoteParticipant("remote-1", "portal-1", contact.id, "renamed@example.test");
    const save = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-1")]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue(correlationProperties()), registerParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([participant])), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result).toMatchObject({ status: 201, body: { participants: [{ id: "portal-1", opportunityContactId: contact.id }] } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "portal-1", cloudShareParticipantId: "remote-1" }));
  });

  it("backfills legacy participant properties only after the admin explicitly selects its contact", async () => {
    const legacy = { ...remoteParticipant("remote-legacy"), customProperties: { unrelated: "preserve-me" } };
    let upgraded: ReturnType<typeof remoteParticipant> = remoteParticipant("remote-legacy");
    let backfilled = false;
    const updateParticipantCorrelation = vi.fn().mockImplementation(async (_salesId, _participantId, input) => {
      const properties = Object.fromEntries(input.customProperties.map((property: { readonly name: string; readonly value: string }) => [property.name, property.value]));
      upgraded = remoteParticipant("remote-legacy", properties.certalisSalesParticipantId, properties.certalisOpportunityContactId);
      backfilled = true;
      return { request: { method: "PUT", path: "/v4/sales/remote-sales-1/participants/remote-legacy", body: input }, response: { status: 200 } };
    });
    const listParticipants = vi.fn().mockImplementation(async () => rosterEvidence([backfilled ? upgraded : legacy]));
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue(correlationProperties()), updateParticipantCorrelation, registerParticipants: vi.fn(), listParticipants, inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(201);
    expect(updateParticipantCorrelation).toHaveBeenCalledWith("remote-sales-1", "remote-legacy", expect.objectContaining({ customProperties: expect.arrayContaining([{ name: "unrelated", value: "preserve-me" }, { name: "certalisOpportunityContactId", value: contact.id }]) }));
  });

  it("repairs a selected persisted legacy mapping instead of creating a duplicate participant", async () => {
    let repaired = false;
    const updateParticipantCorrelation = vi.fn().mockImplementation(async () => {
      repaired = true;
      return { request: { method: "PUT", path: "/v4/sales/remote-sales-1/participants/remote-1" }, response: { status: 200 } };
    });
    const listParticipants = vi.fn().mockImplementation(async () => rosterEvidence([repaired ? remoteParticipant("remote-1", "portal-1", contact.id) : remoteParticipant("remote-1")]));
    const registerParticipants = vi.fn();
    const diagnostics = { record: vi.fn() };
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-1")]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue(correlationProperties()), updateParticipantCorrelation, registerParticipants, listParticipants, inviteParticipants: vi.fn() }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(201);
    expect(updateParticipantCorrelation).toHaveBeenCalledWith("remote-sales-1", "remote-1", expect.objectContaining({ customProperties: expect.arrayContaining([{ name: "certalisSalesParticipantId", value: "portal-1" }, { name: "certalisOpportunityContactId", value: contact.id }]) }));
    expect(registerParticipants).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ adoptedLegacyParticipantCount: 0, repairedPersistedParticipantCount: 1 }) }));
  });

  it("fails closed before repair when another provider row already owns the persisted identity", async () => {
    const ensureParticipantCorrelationProperties = vi.fn().mockResolvedValue(correlationProperties());
    const updateParticipantCorrelation = vi.fn();
    const registerParticipants = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-legacy")]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties, updateParticipantCorrelation, registerParticipants, listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-legacy"), remoteParticipant("remote-already-correlated", "portal-1", contact.id)])), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(502);
    expect(ensureParticipantCorrelationProperties).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(registerParticipants).not.toHaveBeenCalled();
  });

  it("does not let a different same-email Contact adopt a provider row already persisted to another Contact", async () => {
    const secondContact = { ...contact, id: "contact-2" };
    const updateParticipantCorrelation = vi.fn();
    const registerParticipants = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(secondContact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-legacy")]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn(), updateParticipantCorrelation, registerParticipants, listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-legacy")])), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [secondContact.id] } });

    expect(result.status).toBe(502);
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(registerParticipants).not.toHaveBeenCalled();
  });

  it("uses a stable portal identity and rejects duplicate provider rows from concurrent registration", async () => {
    const registrations: Array<{ readonly customProperties: readonly { readonly name: string; readonly value: string }[] }> = [];
    let reads = 0;
    const listParticipants = vi.fn().mockImplementation(async () => {
      reads += 1;
      if (reads <= 2) return rosterEvidence([]);
      return rosterEvidence(registrations.map((registration, index) => remoteParticipant(`remote-${index + 1}`, registration.customProperties.find((property) => property.name === "certalisSalesParticipantId")?.value, registration.customProperties.find((property) => property.name === "certalisOpportunityContactId")?.value)));
    });
    const registerParticipants = vi.fn().mockImplementation(async (_salesId, participants) => { registrations.push(...participants); return { request: { method: "POST", path: "/v4/sales/remote-sales-1/participants" }, response: { status: 201 } }; });
    const deps = {
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue(correlationProperties()), registerParticipants, listParticipants, inviteParticipants: vi.fn() }) },
    };
    const request = { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } };
    const [first, second] = await Promise.all([handleRegisterSalesSessionParticipants(deps, request), handleRegisterSalesSessionParticipants(deps, request)]);

    expect(first.status).toBe(502);
    expect(second.status).toBe(502);
    expect(registrations).toHaveLength(2);
    expect(registrations[0]!.customProperties.find((property) => property.name === "certalisSalesParticipantId")?.value).toBe(registrations[1]!.customProperties.find((property) => property.name === "certalisSalesParticipantId")?.value);
  });

  it("fails closed before any mutation when selected duplicate-email Contacts could claim one legacy provider participant", async () => {
    const updateParticipantCorrelation = vi.fn();
    const registerParticipants = vi.fn();
    const ensureParticipantCorrelationProperties = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockImplementation(async (_customerId, id) => ({ ...contact, id })) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties, updateParticipantCorrelation, registerParticipants, listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-legacy")])), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: ["contact-1", "contact-2"] } });

    expect(result.status).toBe(502);
    expect(ensureParticipantCorrelationProperties).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(registerParticipants).not.toHaveBeenCalled();
  });

  it("fails closed before mutation when CloudShare returns duplicate preexisting property identities", async () => {
    const duplicated = [remoteParticipant("remote-1", "portal-1", contact.id), remoteParticipant("remote-2", "portal-1", contact.id)];
    const ensureParticipantCorrelationProperties = vi.fn();
    const registerParticipants = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties, registerParticipants, listParticipants: vi.fn().mockResolvedValue(rosterEvidence(duplicated)), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(502);
    expect(ensureParticipantCorrelationProperties).not.toHaveBeenCalled();
    expect(registerParticipants).not.toHaveBeenCalled();
  });

  it("fails closed before mutation when CloudShare has only the portal participant property", async () => {
    const ensureParticipantCorrelationProperties = vi.fn();
    const registerParticipants = vi.fn();
    const updateParticipantCorrelation = vi.fn();
    const incomplete = { ...remoteParticipant("remote-partial"), customProperties: { certalisSalesParticipantId: "portal-partial" } };
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties, updateParticipantCorrelation, registerParticipants, listParticipants: vi.fn().mockResolvedValue(rosterEvidence([incomplete])), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(502);
    expect(ensureParticipantCorrelationProperties).not.toHaveBeenCalled();
    expect(updateParticipantCorrelation).not.toHaveBeenCalled();
    expect(registerParticipants).not.toHaveBeenCalled();
  });

  it("shows both the completed roster read and a failing participant mutation in correlated diagnostics", async () => {
    const diagnostics = { record: vi.fn() };
    const registerParticipants = vi.fn().mockRejectedValue(new CloudShareResponseError("provider unavailable", { method: "POST", path: "/v4/sales/remote-sales-1/participants", status: 503, responseStatus: 503, responseBody: { error: "unavailable" } }));
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn().mockResolvedValue(correlationProperties()), registerParticipants, listParticipants: vi.fn().mockResolvedValue(rosterEvidence([])), inviteParticipants: vi.fn() }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ method: "POST", path: "/v4/sales/remote-sales-1/participants" }), details: expect.objectContaining({ httpExchanges: expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) }), expect.objectContaining({ request: expect.objectContaining({ method: "POST", path: "/v4/sales/remote-sales-1/participants" }) })]) }) }));
  });

  it("fails before CloudShare when the persisted participant mapping cannot be read", async () => {
    const diagnostics = { record: vi.fn() };
    const listParticipants = vi.fn();
    const findByCustomerId = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockRejectedValue(new Error("database unavailable")), save: vi.fn() }, connections: { findByCustomerId },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn(), registerParticipants: vi.fn(), listParticipants, inviteParticipants: vi.fn() }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ error: "Could not verify the persisted Sales Participant mapping.", correlationId: expect.any(String) });
    expect(findByCustomerId).not.toHaveBeenCalled(); expect(listParticipants).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "participant_mapping_persistence" }) }));
  });

  it("recovers a missing local mapping only from the two CloudShare property values", async () => {
    const remote = remoteParticipant("remote-1", "portal-1", contact.id, "renamed@example.test");
    const save = vi.fn();
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-1")]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) }) },
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 200, body: { participants: [{ id: "portal-1", opportunityContactId: contact.id }] } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "portal-1", cloudShareParticipantId: "remote-1" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", salesDemoSessionId: session.id }));
  });

  it("refuses to import a roster participant with only a coincident email", async () => {
    const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1")])) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "participant_roster_mapping_unresolved", unmatchedCloudShareParticipantCount: 1 }) }));
  });

  it("labels a returned legacy provider row as repairable rather than missing", async () => {
    const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant("portal-1", contact.id, "remote-1")]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1")])) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 200, body: { participants: [{ id: "portal-1", needsAttention: true, requiresCorrelationRepair: true }] } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ message: "CloudShare returned one or more Sales Participants without their Certalis correlation properties; select those Contacts to repair the mappings.", details: expect.objectContaining({ correlationRepairRequiredCount: 1 }) }));
  });

  it("refuses property correlation when its Contact is outside the Session Opportunity", async () => {
    const remote = remoteParticipant("remote-1", "portal-1", contact.id);
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue({ ...contact, opportunityId: "foreign-opportunity" }) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) }) },
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(502);
  });

  it("refuses duplicate provider property identities instead of choosing either participant", async () => {
    const duplicate = [remoteParticipant("remote-1", "portal-1", contact.id), remoteParticipant("remote-2", "portal-1", contact.id)];
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence(duplicate)) }) },
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(502);
  });

  it("updates a persisted mapping from the property-correlated roster and keeps environment IDs server-only", async () => {
    const remote = { ...remoteParticipant("provider-changed", "portal-1", contact.id), invitationStatus: "sent" as const, participationStatus: "inProgress" as const, environmentId: "environment-1", envStatus: null };
    const save = vi.fn();
    const recordEnvironmentObservation = vi.fn();
    const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const environmentRead = { snapshot: { environmentExternalId: "environment-1", status: "running" as const, statusCode: 2 }, request: { method: "GET", path: "/api/v3/envs/environment-1" }, response: { status: 200, body: { statusCode: 2 } } };
    const result = await handleListSalesSessionParticipants({
      now: () => new Date("2026-07-19T08:00:00.000Z"),
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([{ ...storedParticipant("portal-1", contact.id, "provider-old"), lastInvitedAt: new Date("2026-07-17T08:00:00.000Z") }]), save, recordEnvironmentObservation }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) }) },
      environmentFactory: { forConnection: () => ({ getEnvironmentState: vi.fn().mockResolvedValue(environmentRead.snapshot), readEnvironmentState: vi.fn().mockResolvedValue(environmentRead) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 200, body: { session: { accessWindow: { dimension: "certalis_session_access_window", value: "before_window", source: "schedule_calculation", nativeInvitationsAvailable: true } }, participants: [{ id: "portal-1", email: "ada@example.test", invitationStatus: "sent", lastInvitedAt: "2026-07-17T08:00:00.000Z", envStatus: null, environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v3_environment", observedAt: "2026-07-19T08:00:00.000Z" } }] } });
    expect(JSON.stringify(result.body)).not.toContain("lifecycle");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ cloudShareParticipantId: "provider-changed", cloudShareEnvironmentId: "environment-1", lastInvitedAt: new Date("2026-07-17T08:00:00.000Z") }));
    expect(recordEnvironmentObservation).toHaveBeenCalledWith("customer-1", "portal-1", { statusCode: 2, observedAt: new Date("2026-07-19T08:00:00.000Z") });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.participant.environment_observed", outcome: "success", customerId: "customer-1", request: environmentRead.request, response: environmentRead.response, details: expect.objectContaining({ integrationSurface: "cloudshare.v3.environments", observation: "observed" }) }));
    expect(JSON.stringify(result.body)).not.toContain("provider-changed");
    expect(JSON.stringify(result.body)).not.toContain("environment-1");
  });

  it("resolves v3 Environment state by server-side Contact email and the Customer Item project", async () => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "1234567890123456789", envStatus: null };
    const observe = vi.fn().mockResolvedValue({ environmentId: "opaque-v3-id", statusCode: 2, exchanges: [{ request: { method: "GET", path: "/api/v3/envs", query: { ownerEmail: contact.email, brief: "false" } }, response: { status: 200, body: [] } }, { request: { method: "GET", path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-id" } }, response: { status: 200, body: { statusCode: 2 } } }] });
    const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue({ ...session, itemId: "item-1" }) }, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "customer-1", project: { id: "project-1", name: "Project" } }) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn(), recordEnvironmentObservation: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, salesEnvironmentFactory: { forConnection: () => ({ observe }) }, diagnostics, audit,
    }, { customerId: "customer-1", sessionId: session.id, actor });
    expect(result).toMatchObject({ status: 200, body: { participants: [{ environment: { value: "Ready", source: "cloudshare_v3_environment" } }] } });
    expect(observe).toHaveBeenCalledWith({ ownerEmail: contact.email, projectId: "project-1" });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ path: "/api/v3/envs/actions/getextended" }), response: expect.objectContaining({ body: { statusCode: 2 } }), details: expect.objectContaining({ resolutionSource: "owner_email_and_item_project" }) }));
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ httpExchanges: expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ path: "/api/v3/envs" }) }), expect.objectContaining({ request: expect.objectContaining({ path: "/api/v3/envs/actions/getextended" }) })]) }) }));
    const auditEvidence = JSON.stringify(audit.write.mock.calls);
    expect(auditEvidence).not.toContain("opaque-v3-id");
    expect(auditEvidence).not.toContain("1234567890123456789");
    expect(auditEvidence).not.toContain("provider-1");
    expect(auditEvidence).not.toContain(session.cloudShareSalesExperienceId);
    expect(JSON.stringify(result.body)).not.toContain("opaque-v3-id");
    expect(JSON.stringify(result.body)).not.toContain("1234567890123456789");
  });

  it.each([["Deleted", "Deleted"], ["FutureAllocationScheduled", "Future allocation scheduled"]] as const)("uses documented v4 roster Environment state %s without a separate v3 resolution", async (envStatus, expectedValue) => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "roster-reference", envStatus };
    const observe = vi.fn().mockRejectedValue(new Error("v3 resolution must not run for a roster state"));
    const recordEnvironmentObservation = vi.fn();
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue({ ...session, itemId: "item-1" }) }, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "customer-1", project: { id: "project-1", name: "Project" } }) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn(), recordEnvironmentObservation }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, salesEnvironmentFactory: { forConnection: () => ({ observe }) }, diagnostics: { record: vi.fn() },
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 200, body: { participants: [{ environment: { dimension: "cloudshare_environment", value: expectedValue, source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-19T08:00:00.000Z" } }] } });
    expect(result.body.participants).not.toEqual(expect.arrayContaining([expect.objectContaining({ needsAttention: true, attentionSource: "cloudshare_v3_owner_email_item_project" })]));
    expect(observe).not.toHaveBeenCalled();
    expect(recordEnvironmentObservation).toHaveBeenCalledWith("customer-1", "portal-1", { statusCode: null, observedAt: new Date("2026-07-19T08:00:00.000Z") });
  });

  it.each(["environment_not_found_for_project", "environment_ambiguous_for_project"] as const)("fails closed with actual v3 list diagnostics for %s", async (reason) => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "1234567890123456789" };
    const listExchange = { request: { method: "GET" as const, path: "/api/v3/envs", query: { ownerEmail: contact.email, brief: "false" } }, response: { status: 200, body: { items: [] } } };
    const diagnostics = { record: vi.fn() }; const recordEnvironmentObservation = vi.fn();
    const result = await handleListSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ ...session, itemId: "item-1" }) }, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "customer-1", project: { id: "project-1", name: "Project" } }) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn(), recordEnvironmentObservation }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, salesEnvironmentFactory: { forConnection: () => ({ observe: vi.fn().mockRejectedValue(new SalesEnvironmentResolutionError(reason, [listExchange])) }) }, diagnostics }, { customerId: "customer-1", sessionId: session.id, actor });
    expect(result).toMatchObject({ status: 200, body: { participants: [{ needsAttention: true, attentionReason: reason, attentionSource: "cloudshare_v3_owner_email_item_project" }] } });
    expect(recordEnvironmentObservation).toHaveBeenCalledWith("customer-1", "portal-1", { statusCode: null, observedAt: null, attentionReason: reason, attentionSource: "cloudshare_v3_owner_email_item_project" });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", request: listExchange.request, response: listExchange.response, details: expect.objectContaining({ attentionReason: reason, integrationSurface: "cloudshare.v3.environments" }) }));
  });

  it("preserves the getextended exchange when observation persistence and cleanup both fail", async () => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "1234567890123456789" };
    const extended = { request: { method: "GET" as const, path: "/api/v3/envs/actions/getextended", query: { envId: "opaque-v3-id" } }, response: { status: 200, body: { statusCode: 2 } } };
    const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ ...session, itemId: "item-1" }) }, items: { findById: vi.fn().mockResolvedValue({ id: "item-1", customerId: "customer-1", project: { id: "project-1", name: "Project" } }) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn(), recordEnvironmentObservation: vi.fn().mockRejectedValue(new Error("database unavailable")) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, salesEnvironmentFactory: { forConnection: () => ({ observe: vi.fn().mockResolvedValue({ environmentId: "opaque-v3-id", statusCode: 2, exchanges: [extended] }) }) }, diagnostics }, { customerId: "customer-1", sessionId: session.id, actor });
    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ path: "/api/v3/envs/actions/getextended" }), response: extended.response, details: expect.objectContaining({ integrationSurface: "cloudshare.v3.environments", failureMode: "environment_observation_persistence" }) }));
  });

  it("bounds per-participant CloudShare Environment polling during roster reconciliation", async () => {
    const contacts = Array.from({ length: 9 }, (_, index) => ({ ...contact, id: `contact-${index}`, customerId: "customer-1", email: `person-${index}@example.test`, archivedAt: null, createdAt: new Date(), updatedAt: new Date() }));
    const stored = contacts.map((value, index) => ({ ...storedParticipant(`portal-${index}`, value.id, `provider-${index}`), cloudShareEnvironmentId: `environment-${index}` }));
    const remote = contacts.map((value, index) => ({ ...remoteParticipant(`provider-${index}`, `portal-${index}`, value.id), environmentId: `environment-${index}` }));
    let active = 0; let maximumActive = 0;
    const readEnvironmentState = vi.fn(async (environmentId: string) => {
      active += 1; maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return { snapshot: { environmentExternalId: environmentId, status: "running" as const, statusCode: 2 }, request: { method: "GET", path: `/api/v3/envs/${environmentId}` }, response: { status: 200 } };
    });
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn(async (_customerId, id) => contacts.find((value) => value.id === id) ?? null) }, participants: { list: vi.fn().mockResolvedValue(stored), save: vi.fn(), recordEnvironmentObservation: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence(remote)) } as never) }, environmentFactory: { forConnection: () => ({ getEnvironmentState: vi.fn(), readEnvironmentState }) }, diagnostics: { record: vi.fn() },
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(200);
    expect(readEnvironmentState).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBeLessThanOrEqual(4);
  });

  it("clears a prior Environment observation after a completed v3 404 and records its protected exchange", async () => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "environment-1", envStatus: null };
    const recordEnvironmentObservation = vi.fn(); const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([{ ...storedParticipant(), cloudShareEnvironmentId: "environment-1", environmentStatusCode: 2, environmentObservedAt: new Date("2026-07-18T08:00:00Z") }]), save: vi.fn(), recordEnvironmentObservation }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, environmentFactory: { forConnection: () => ({ getEnvironmentState: vi.fn().mockResolvedValue(null), readEnvironmentState: vi.fn().mockResolvedValue({ snapshot: null, request: { method: "GET", path: "/api/v3/envs/environment-1" }, response: { status: 404, body: { message: "not found" } } }) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 200, body: { participants: [{ environment: { value: null, source: "not_observed" } }] } });
    expect(recordEnvironmentObservation).toHaveBeenCalledWith("customer-1", "portal-1", { statusCode: null, observedAt: null });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", response: expect.objectContaining({ status: 404 }), details: expect.objectContaining({ integrationSurface: "cloudshare.v3.environments", observation: "not_found" }) }));
  });

  it("records protected monitoring failure when the Customer-scoped environment observation row disappears", async () => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "environment-1", envStatus: null };
    const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([{ ...storedParticipant(), cloudShareEnvironmentId: "environment-1" }]), save: vi.fn(), recordEnvironmentObservation: vi.fn().mockRejectedValue(new Error("Sales Session Participant was not found for this Customer")) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, environmentFactory: { forConnection: () => ({ getEnvironmentState: vi.fn(), readEnvironmentState: vi.fn().mockResolvedValue({ snapshot: { environmentExternalId: "environment-1", statusCode: 2 }, request: { method: "GET", path: "/api/v3/envs/environment-1" }, response: { status: 200 } }) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", request: { method: "GET", path: "/api/v3/envs/environment-1", query: undefined, headers: undefined, body: undefined }, response: { status: 200, headers: undefined, body: undefined, transport: undefined }, details: expect.objectContaining({ integrationSurface: "cloudshare.v3.environments", failureMode: "environment_observation_persistence" }) }));
  });

  it("clears stale Environment state and fails with accurately-labelled v3 diagnostics for an unrecognized completed observation", async () => {
    const remote = { ...remoteParticipant("provider-1", "portal-1", contact.id), environmentId: "environment-1", envStatus: null };
    const recordEnvironmentObservation = vi.fn(); const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([{ ...storedParticipant(), cloudShareEnvironmentId: "environment-1", environmentStatusCode: 2, environmentObservedAt: new Date("2026-07-18T08:00:00Z") }]), save: vi.fn(), recordEnvironmentObservation }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) } as never) }, environmentFactory: { forConnection: () => ({ getEnvironmentState: vi.fn(), readEnvironmentState: vi.fn().mockResolvedValue({ snapshot: { environmentExternalId: "environment-1", status: "unknown" }, request: { method: "GET", path: "/api/v3/envs/environment-1" }, response: { status: 200, body: { statusCode: 99 } } }) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(502);
    expect(recordEnvironmentObservation).toHaveBeenCalledWith("customer-1", "portal-1", { statusCode: null, observedAt: null });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", request: expect.objectContaining({ method: "GET", path: "/api/v3/envs/environment-1" }), response: expect.objectContaining({ status: 200, body: { statusCode: 99 } }), details: expect.objectContaining({ integrationSurface: "cloudshare.v3.environments", failureMode: "environment_status_observation" }) }));
  });

  it("keeps the completed roster exchange when property-based mapping persistence fails", async () => {
    const diagnostics = { record: vi.fn() };
    const remote = remoteParticipant("remote-1", "portal-1", contact.id);
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn().mockRejectedValue(new Error("database unavailable")) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 200, body: expect.objectContaining({ items: [remote] }) }), details: expect.objectContaining({ failureMode: "participant_mapping_persistence", error: expect.stringContaining("database unavailable") }) }));
  });

  it("never invokes the provider POST when the durable dispatch transition fails", async () => {
    const participant = storedParticipant(); const commandId = randomUUID(); const inviteParticipants = vi.fn();
    const ledger: SalesParticipantInvitationLedger = {
      admitBatch: vi.fn().mockResolvedValue({ kind: "admitted", commandId, admissionToken: "required-token" }),
      markBatchDispatching: vi.fn().mockRejectedValue(new Error("dispatch fence lost")),
      markBatchEvaluatingConfirmation: vi.fn(), expireAdmitted: vi.fn(), recoverExpiredInvitationCommand: vi.fn(), failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand: vi.fn().mockResolvedValue(null), readCurrent: vi.fn(),
    };
    await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1", participant.id, participant.opportunityContactId)])), inviteParticipants }) } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "invite", commandId) });
    expect(ledger.markBatchDispatching).toHaveBeenCalledWith("customer-1", commandId, "required-token", 1, fixedNow());
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it("maps selected portal IDs to customer-scoped provider IDs before native invitation", async () => {
    const inviteParticipants = vi.fn().mockResolvedValue({ request: {}, response: { status: 200 } });
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")])), inviteParticipants }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result.status).toBe(202);
    expect(inviteParticipants).toHaveBeenCalledWith("remote-sales-1", ["remote-1"]);
    expect(JSON.stringify(result.body)).not.toContain("remote-1");
  });

  it("refuses native invitations before mutation when the Sales Experience disables participant invitation email", async () => {
    const experience = { id: "remote-sales-1", sendInvitations: "dontSend" as const, request: { method: "GET", path: "/v4/sales/remote-sales-1" }, response: { status: 200, body: { id: "remote-sales-1", sendInvitations: "dontSend" } } };
    const readSession = vi.fn().mockResolvedValue(experience);
    const inviteParticipants = vi.fn();
    const diagnostics = { record: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: readSession, listParticipants: vi.fn(), inviteParticipants }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result).toMatchObject({ status: 409, body: { code: "native_invitations_disabled", error: "CloudShare has native invitations disabled for this Sales Experience. Enable invitations in CloudShare before sending or resending." } });
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      message: "CloudShare native invitations are disabled for this Sales Experience.",
      request: experience.request,
      response: experience.response,
      details: expect.objectContaining({ failureMode: "native_invitations_disabled", sendInvitations: "dontSend" }),
    }));
  });

  it("does not report a native invitation as sent until CloudShare's roster confirms it", async () => {
    const inviteParticipants = vi.fn().mockResolvedValue({ request: { method: "POST", path: "/v4/sales/remote-sales-1/participants/invite", body: ["remote-1"] }, response: { status: 200, body: "" } });
    const listParticipants = vi.fn()
      .mockResolvedValueOnce(rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")]))
      .mockResolvedValueOnce(rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")]));
    const diagnostics = { record: vi.fn() };

    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants, inviteParticipants }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result).toMatchObject({ status: 202, body: { outcome: "confirmation_required", invitationConfirmation: "pending", confirmedParticipantCount: 0, pendingConfirmationParticipantCount: 1 } });
    expect(listParticipants).toHaveBeenCalledTimes(2);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      message: "CloudShare accepted the native invitation request, but has not yet confirmed the invitation as sent.",
      details: expect.objectContaining({ confirmedParticipantCount: 0, pendingConfirmationParticipantCount: 1, httpExchanges: expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) })]) }),
    }));
  });

  it("sets lastInvitedAt on the authoritative explicit invite confirmation", async () => {
    const save = vi.fn();
    const before = rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")]);
    const after = rosterEvidence([{ ...remoteParticipant("remote-1", "portal-1", "contact-1"), invitationStatus: "sent" as const, invitedBy: "sender@example.test" }]);
    await handleInviteSalesSessionParticipants({ now: () => new Date("2026-07-18T12:00:00.000Z"), sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after), inviteParticipants: vi.fn().mockResolvedValue({ request: { method: "POST", path: "/sales/sales-1/participants/invite" }, response: { status: 200 } }) }) } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });
    expect(save).not.toHaveBeenCalled();
  });

  it("does not treat an already-sent participant as confirmation that a resend was dispatched", async () => {
    const sent = { ...remoteParticipant("remote-1", "portal-1", "contact-1"), invitationStatus: "sent" as const };
    const persisted = { ...storedParticipant(), invitationStatus: "sent" as const, lastInvitedAt: new Date("2026-07-17T13:00:00.000Z") };
    const listParticipants = vi.fn().mockResolvedValue(rosterEvidence([sent]));
    const save = vi.fn();

    const result = await handleInviteSalesSessionParticipants({
      now: () => new Date("2026-07-18T13:00:00.000Z"), sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([persisted]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants, inviteParticipants: vi.fn().mockResolvedValue({ request: { method: "POST", path: "/v4/sales/remote-sales-1/participants/invite" }, response: { status: 200 } }) }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(persisted, "resend") });

    expect(result).toMatchObject({ status: 200, body: { invitationConfirmation: "pending", confirmedParticipantCount: 0, pendingConfirmationParticipantCount: 1 } });
    expect(save).not.toHaveBeenCalled();
  });

  it("retains the acknowledged invite and roster exchanges when post-acknowledgement persistence fails", async () => {
    const current = rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")]);
    const afterRequest = rosterEvidence([{ ...remoteParticipant("remote-1", "portal-1", "contact-1"), invitationStatus: "sent" as const }]);
    const requested = { request: { method: "POST", path: "/v4/sales/remote-sales-1/participants/invite", body: ["remote-1"] }, response: { status: 200, body: "" } };
    const diagnostics = { record: vi.fn() };

    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(afterRequest), inviteParticipants: vi.fn().mockResolvedValue(requested) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result).toMatchObject({ status: 200, body: { invitationConfirmation: "confirmed" } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", request: requested.request, response: requested.response }));
  });

  it("retains the acknowledged invite and failing confirmation read when CloudShare cannot confirm it", async () => {
    const current = rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")]);
    const requested = { request: { method: "POST", path: "/v4/sales/remote-sales-1/participants/invite", body: ["remote-1"] }, response: { status: 200, body: "" } };
    const confirmationFailure = new CloudShareResponseError("roster unavailable", { method: "GET", path: "/v4/sales/remote-sales-1/participants", status: 503, responseStatus: 503, responseBody: { error: "unavailable" } });
    const diagnostics = { record: vi.fn() };
    const save = vi.fn();

    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValueOnce(current).mockRejectedValueOnce(confirmationFailure), inviteParticipants: vi.fn().mockResolvedValue(requested) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result).toMatchObject({ status: 202, body: { outcome: "confirmation_required", error: "CloudShare accepted the native invitation request, but Certalis could not confirm or save its result. Do not retry until support diagnostics are reviewed." } });
    expect(save).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({
      request: requested.request,
      response: requested.response,
      details: expect.objectContaining({ failureMode: "participant_invitation_confirmation", httpExchanges: expect.arrayContaining([current, requested, expect.objectContaining({ request: expect.objectContaining({ method: "GET" }), response: expect.objectContaining({ status: 503 }) })]) }),
    }));
  });

  it("refuses an invite when the provider row no longer carries its exact Certalis identity pair", async () => {
    const inviteParticipants = vi.fn();
    const diagnostics = { record: vi.fn() };
    const capability = invitationEnabledEvidence();
    const roster = rosterEvidence([remoteParticipant("remote-1")]);
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(capability), listParticipants: vi.fn().mockResolvedValue(roster), inviteParticipants }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });

    expect(result.status).toBe(409);
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "participant_mapping_missing_from_cloudshare", httpExchanges: [capability, roster] }) }));
  });

  it("refuses duplicate provider correlation and a stale remote invitation state before dispatch", async () => {
    const participant = storedParticipant(); const inviteParticipants = vi.fn(); const failAdmitted = vi.fn();
    const ledger: SalesParticipantInvitationLedger = {
      admitBatch: vi.fn(async ({ commandId }) => ({ kind: "admitted" as const, commandId, admissionToken: "token" })), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted, finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand: vi.fn().mockResolvedValue(null), readCurrent: vi.fn(),
    };
    const duplicated = rosterEvidence([
      { ...remoteParticipant("remote-1", participant.id, participant.opportunityContactId), invitationStatus: "sent" as const },
      { ...remoteParticipant("remote-duplicate", participant.id, participant.opportunityContactId), invitationStatus: "sent" as const },
    ]);
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValue(duplicated), inviteParticipants } as never) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant) });
    expect(result.status).toBe(409);
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(failAdmitted).toHaveBeenCalledOnce();
  });

  it.each([
    ["participant", [remoteParticipant("remote-1", "portal-1", "contact-1"), remoteParticipant("remote-2", "portal-1", "other-contact")]],
    ["contact", [remoteParticipant("remote-1", "portal-1", "contact-1"), remoteParticipant("remote-2", "other-participant", "contact-1")]],
  ] as const)("requires the %s correlation key to be independently unique before dispatch", async (_key, participants) => {
    const inviteParticipants = vi.fn();
    const result = await handleInviteSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([...participants])), inviteParticipants }) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(storedParticipant()) });
    expect(result.status).toBe(409);
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it("refuses a uniquely correlated provider row whose current invitation state is stale", async () => {
    const participant = storedParticipant(); const inviteParticipants = vi.fn();
    const stale = rosterEvidence([{ ...remoteParticipant("remote-1", participant.id, participant.opportunityContactId), invitationStatus: "sent" as const }]);
    const result = await handleInviteSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValue(stale), inviteParticipants } as never) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant) });
    expect(result.status).toBe(409);
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it("retains typed CloudShare pagination failure facts in support diagnostics", async () => {
    const diagnostics = { record: vi.fn() };
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockRejectedValue(new CloudShareResponseError("CloudShare participant page contains duplicate IDs.", { method: "GET", path: "/v4/sales/remote-sales-1/participants", requestQuery: { offset: "0", limit: "100" }, status: 200, responseStatus: 200, responseBody: { count: 2 }, expectedCount: 2, returnedCount: 2, failureMode: "participant_page_duplicate_id" })) }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ failureMode: "participant_page_duplicate_id", expectedCount: 2, returnedCount: 2 }) }));
  });

  it("keeps OAuth token failure evidence metadata-only during participant roster refresh", async () => {
    const diagnostics = { record: vi.fn() };
    const oauthFailure = Object.assign(new Error("wrapped OAuth token exchange returned 503"), { context: {
      method: "POST",
      path: "/oauth/token",
      integrationSurface: "cloudshare.v4.oauth.token",
      status: 503,
      requestBody: { client_id: "private-client", client_secret: "private-secret" },
      responseBody: { access_token: "private-token" },
    } });
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) },
      records: { findContact: vi.fn() },
      participants: { list: vi.fn().mockResolvedValue([]), save: vi.fn() },
      connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockRejectedValue(oauthFailure) }) },
      diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor });
    const failure = diagnostics.record.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.operation === "sales.demo_session.participants.reconciled" && entry.outcome === "failure");

    expect(result).toMatchObject({ status: 502, body: { correlationId: expect.any(String) } });
    expect(failure).toMatchObject({ request: null, response: null });
    const persisted = JSON.stringify(failure);
    expect(persisted).not.toContain("private-client");
    expect(persisted).not.toContain("private-secret");
    expect(persisted).not.toContain("private-token");
  });

  it("rejects an invite when the selected participant revision is stale", async () => {
    const participant = storedParticipant();
    const inviteParticipants = vi.fn();
    const save = vi.fn();
    const diagnostics = { record: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() },
      participants: { list: vi.fn().mockResolvedValue([participant]), save },
      connections: { findByCustomerId: vi.fn() },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn(), listParticipants: vi.fn(), inviteParticipants }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { ...explicitInviteBody(participant), targets: [{ ...explicitInviteBody(participant).targets[0], participantRevision: "2026-07-19T08:00:00.000Z" }] } });

    expect(result).toMatchObject({ status: 409, body: { code: "participant_revision_stale" } });
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects an invite when intent and expected status do not match the stored participant", async () => {
    const participant = storedParticipant();
    const inviteParticipants = vi.fn();
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() },
      participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() },
      connections: { findByCustomerId: vi.fn() },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn(), listParticipants: vi.fn(), inviteParticipants }) }, diagnostics: { record: vi.fn() },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { ...explicitInviteBody(participant), targets: [{ ...explicitInviteBody(participant).targets[0], intent: "resend", expectedInvitationStatus: "sent" }] } });

    expect(result).toMatchObject({ status: 409, body: { code: "participant_revision_stale" } });
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it("accepts a valid resend precondition for an already-sent participant", async () => {
    const participant = { ...storedParticipant(), invitationStatus: "sent" as const, lastInvitedAt: new Date("2026-07-18T08:00:00.000Z") };
    const inviteParticipants = vi.fn().mockResolvedValue({ request: { method: "POST", path: "/invite" }, response: { status: 200 }, dispatchOutcome: "acknowledged" as const });
    const roster = rosterEvidence([{ ...remoteParticipant("remote-1", "portal-1", "contact-1"), invitationStatus: "sent" as const }]);
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() },
      participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), readParticipantInvitationCapability: vi.fn().mockResolvedValue(invitationEnabledEvidence()), listParticipants: vi.fn().mockResolvedValue(roster), inviteParticipants }) }, diagnostics: { record: vi.fn() },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "resend") });

    expect(result.status).toBe(200);
    expect(inviteParticipants).toHaveBeenCalledWith("remote-sales-1", ["remote-1"]);
  });

  it("reconciles a retained initial invite without redispatching", async () => {
    const participant = storedParticipant();
    const inviteParticipants = vi.fn();
    const commandId = randomUUID();
    const ledger: SalesParticipantInvitationLedger = {
      admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }),
      markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted: vi.fn(), finishBatch: vi.fn().mockResolvedValue({ customerId: "customer-1", commandId, phase: "settled", revision: 4, correlationId: "corr-1" }), finishBatchWithParticipantProjections: vi.fn().mockResolvedValue({ customerId: "customer-1", commandId, phase: "settled", revision: 4, correlationId: "corr-1" }),
      readCommand: vi.fn().mockResolvedValue({ command: { customerId: "customer-1", commandId, phase: "settled", revision: 3, correlationId: "corr-1" }, targets: [{ participantId: participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: participant.updatedAt.toISOString() }], outcome: { commandId, outcome: "blocked", correlationId: "corr-1", counts: {}, targets: [{ participantId: participant.id, outcome: "no_replay", reason: "ambiguous_after_dispatch" }] } }),
      readCurrent: vi.fn().mockResolvedValue(null),
    };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([{ ...remoteParticipant("remote-1", "portal-1", "contact-1"), invitationStatus: "sent" as const }])) , inviteParticipants }) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: { commandId, targets: [{ participantId: participant.id, intent: "invite", expectedInvitationStatus: "notSent", participantRevision: participant.updatedAt.toISOString() }] } });
    expect(result.status).toBe(200);
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(ledger.finishBatchWithParticipantProjections).toHaveBeenCalledWith(expect.objectContaining({ expectedPhase: "settled", projections: expect.any(Array) }));
  });

  it("does not reconcile or clear an indefinitely retained resend no-replay command", async () => {
    const participant = { ...storedParticipant(), invitationStatus: "sent" as const };
    const commandId = randomUUID();
    const inviteParticipants = vi.fn();
    const ledger: SalesParticipantInvitationLedger = {
      admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }),
      markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(),
      readCommand: vi.fn().mockResolvedValue({
        command: { customerId: "customer-1", commandId, phase: "settled", revision: 4, correlationId: "corr-resend" },
        outcome: { commandId, outcome: "blocked", correlationId: "corr-resend", counts: { no_replay: 1 }, targets: [{ participantId: participant.id, outcome: "no_replay", reason: "ambiguous_after_dispatch" }] },
      }),
      readCurrent: vi.fn().mockResolvedValue(null),
    };
    const listParticipants = vi.fn().mockRejectedValue(new Error("reconciliation must not run"));
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger,
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() },
      participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants, inviteParticipants }) }, diagnostics: { record: vi.fn() },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "resend", commandId) });
    expect(result).toMatchObject({ status: 409, body: { code: "command_replayed", outcome: "blocked", commandId } });
    expect(listParticipants).not.toHaveBeenCalled();
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(ledger.finishBatch).not.toHaveBeenCalled();
  });

  it("terminally settles a restarted initial Invite when a complete roster proves no transition", async () => {
    const participant = storedParticipant(); const commandId = randomUUID(); const correlationId = "corr-restart";
    const evaluating = { command: { customerId: "customer-1", commandId, phase: "evaluating_confirmation" as const, revision: 3, correlationId }, targets: [{ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: participant.updatedAt.toISOString() }], outcome: invitationResult({ commandId, correlationId, outcomes: [{ participantId: participant.id, outcome: "confirmation_required", reason: "confirmation_required" }] }) };
    const settled = { ...evaluating, command: { ...evaluating.command, phase: "settled" as const, revision: 4, httpStatus: 202, resultCode: "invitation_confirmation_required" } };
    const readCommand = vi.fn().mockResolvedValueOnce(evaluating).mockResolvedValueOnce(evaluating).mockResolvedValue(settled); const finishBatchWithParticipantProjections = vi.fn().mockResolvedValue(settled.command);
    const ledger: SalesParticipantInvitationLedger = { admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId, command: evaluating.command }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections, readCommand, readCurrent: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1", participant.id, participant.opportunityContactId)])), inviteParticipants: vi.fn() }) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "invite", commandId) });
    expect(finishBatchWithParticipantProjections).toHaveBeenCalledWith(expect.objectContaining({ expectedPhase: "evaluating_confirmation", phase: "settled", httpStatus: 202, resultCode: "invitation_confirmation_required", projections: [] }));
    expect(result).toMatchObject({ status: 202, body: { code: "invitation_confirmation_required", phase: "settled", outcome: "confirmation_required" } });
  });

  it("fails retained reconciliation closed for a duplicate single correlation key or an intervening participant revision", async () => {
    const participant = storedParticipant(); const commandId = randomUUID();
    const makeLedger = (participantRevision = participant.updatedAt.toISOString()) => {
      const current = { command: { customerId: "customer-1", commandId, phase: "settled" as const, revision: 3, correlationId: "corr-retained" }, targets: [{ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision }], outcome: invitationResult({ commandId, correlationId: "corr-retained", outcomes: [{ participantId: participant.id, outcome: "no_replay" as const, reason: "ambiguous_after_dispatch" as const }] }) };
      return { admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand: vi.fn().mockResolvedValue(current), readCurrent: vi.fn() } satisfies SalesParticipantInvitationLedger;
    };
    const duplicateSingleKey = rosterEvidence([
      { ...remoteParticipant("remote-1", participant.id, participant.opportunityContactId), invitationStatus: "sent" as const },
      { ...remoteParticipant("remote-2", participant.id, "another-contact"), invitationStatus: "sent" as const },
    ]);
    for (const [ledger, roster] of [[makeLedger(), duplicateSingleKey], [makeLedger(new Date(0).toISOString()), rosterEvidence([{ ...remoteParticipant("remote-1", participant.id, participant.opportunityContactId), invitationStatus: "sent" as const }])]] as const) {
      const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(roster), inviteParticipants: vi.fn() }) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "invite", commandId) });
      expect(result).toMatchObject({ status: 409, body: { code: "command_replayed", outcome: "blocked" } });
      expect(ledger.finishBatchWithParticipantProjections).not.toHaveBeenCalled();
    }
  });

  it("recovers an expired pre-dispatch admission and replays it as retryable without dispatch", async () => {
    const participant = storedParticipant(); const commandId = randomUUID(); const inviteParticipants = vi.fn();
    const admitted = { command: { customerId: "customer-1", commandId, phase: "admitted" as const, revision: 1, correlationId: null }, targets: [{ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: participant.updatedAt.toISOString() }], outcome: invitationResult({ commandId, correlationId: null, outcomes: [{ participantId: participant.id, outcome: null, reason: null }] }) };
    const recovered = { command: { ...admitted.command, phase: "settled" as const, revision: 2 }, targets: admitted.targets, outcome: invitationResult({ commandId, correlationId: null, outcomes: [{ participantId: participant.id, outcome: "failed_retryable", reason: "failed_retryable" }] }) };
    const readCommand = vi.fn().mockResolvedValueOnce(admitted).mockResolvedValue(recovered);
    const recoverExpiredInvitationCommand = vi.fn().mockResolvedValue(recovered.command);
    const ledger: SalesParticipantInvitationLedger = { admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), recoverExpiredInvitationCommand, failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand, readCurrent: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection: vi.fn(() => ({ createSession: vi.fn(), readSession: vi.fn(), inviteParticipants } as never)) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "invite", commandId) });
    expect(recoverExpiredInvitationCommand).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", sessionId: session.id, commandId, expectedRevision: 1 }));
    expect(result).toMatchObject({ status: 502, body: { code: "command_replayed", outcome: "failed_retryable" } });
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it("leaves a fresh pre-dispatch admission in progress without dispatching or inventing a token", async () => {
    const participant = storedParticipant(); const commandId = randomUUID();
    const current = { command: { customerId: "customer-1", commandId, phase: "admitted" as const, revision: 1, correlationId: null }, targets: [{ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: participant.updatedAt.toISOString() }], outcome: invitationResult({ commandId, correlationId: null, outcomes: [{ participantId: participant.id, outcome: null, reason: null }] }) };
    const recoverExpiredInvitationCommand = vi.fn().mockResolvedValue(null); const readCommand = vi.fn().mockResolvedValue(current);
    const ledger: SalesParticipantInvitationLedger = { admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), recoverExpiredInvitationCommand, failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand, readCurrent: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection: vi.fn() }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "invite", commandId) });
    expect(result).toMatchObject({ status: 202, body: { code: "command_replayed", outcome: "in_progress" } });
    expect(ledger.markBatchDispatching).not.toHaveBeenCalled();
  });

  it("recovers an expired dispatch marker as retained no-replay without redispatching", async () => {
    const participant = storedParticipant(); const commandId = randomUUID(); const inviteParticipants = vi.fn();
    const dispatching = { command: { customerId: "customer-1", commandId, phase: "dispatching" as const, revision: 2, correlationId: null }, targets: [{ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: participant.updatedAt.toISOString() }], outcome: invitationResult({ commandId, correlationId: null, outcomes: [{ participantId: participant.id, outcome: null, reason: null }] }) };
    const recovered = { command: { ...dispatching.command, phase: "settled" as const, revision: 3 }, targets: dispatching.targets, outcome: invitationResult({ commandId, correlationId: null, outcomes: [{ participantId: participant.id, outcome: "no_replay", reason: "ambiguous_after_dispatch" }] }) };
    const recoverExpiredInvitationCommand = vi.fn().mockResolvedValue(recovered.command); const readCommand = vi.fn().mockResolvedValueOnce(dispatching).mockResolvedValue(recovered);
    const ledger: SalesParticipantInvitationLedger = { admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), recoverExpiredInvitationCommand, failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand, readCurrent: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection: vi.fn(() => ({ createSession: vi.fn(), readSession: vi.fn(), inviteParticipants } as never)) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "invite", commandId) });
    expect(result).toMatchObject({ status: 409, body: { code: "command_replayed", outcome: "blocked", targets: [{ outcome: "no_replay" }] } });
    expect(recoverExpiredInvitationCommand).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it.each([
    ["admitted", null, "in_progress", 202],
    ["settled", "confirmation_required", "confirmation_required", 202],
    ["settled", "failed_retryable", "failed_retryable", 502],
    ["settled", "accepted_unconfirmed", "completed_with_unconfirmed", 200],
    ["settled", "confirmed", "completed", 200],
  ] as const)("replays %s/%s with aggregate %s and HTTP %s", async (phase, targetOutcome, aggregate, status) => {
    const participant = storedParticipant(); const commandId = randomUUID();
    const target = targetOutcome === null
      ? { participantId: participant.id, outcome: null, reason: null } as const
      : { participantId: participant.id, outcome: targetOutcome, reason: targetOutcome === "confirmation_required" ? "confirmation_required" : targetOutcome === "failed_retryable" ? "failed_retryable" : null } as const;
    const current = { command: { customerId: "customer-1", commandId, phase, revision: 3, correlationId: "corr-replay" }, outcome: invitationResult({ commandId, correlationId: "corr-replay", outcomes: [target] }) };
    const ledger: SalesParticipantInvitationLedger = {
      admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted: vi.fn(), finishBatch: vi.fn(), finishBatchWithParticipantProjections: vi.fn(), readCommand: vi.fn().mockResolvedValue(current), readCurrent: vi.fn(),
    };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn(), save: vi.fn() }, connections: { findByCustomerId: vi.fn() }, deliveryFactory: { forConnection: vi.fn() }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: explicitInviteBody(participant, "resend", commandId) });
    expect(result).toMatchObject({ status, body: { outcome: aggregate, commandId, correlationId: "corr-replay", targets: [{ participantId: participant.id, outcome: targetOutcome }] } });
  });

  it("retains the command and leaves projection untouched when reconciliation CAS rejects", async () => {
    const participant = storedParticipant(); const commandId = randomUUID(); const save = vi.fn(); const inviteParticipants = vi.fn();
    const current = { command: { customerId: "customer-1", commandId, phase: "settled" as const, revision: 3, correlationId: "corr-cas" }, targets: [{ participantId: participant.id, intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: participant.updatedAt.toISOString() }], outcome: { commandId, outcome: "blocked" as const, correlationId: "corr-cas", counts: { no_replay: 1 }, targets: [{ participantId: participant.id, outcome: "no_replay" as const, reason: "ambiguous_after_dispatch" as const }] } };
    const finishBatch = vi.fn().mockRejectedValue(new Error("stale command revision"));
    const ledger: SalesParticipantInvitationLedger = { admitBatch: vi.fn().mockResolvedValue({ kind: "same_command", commandId }), markBatchDispatching: vi.fn(), expireAdmitted: vi.fn(), failAdmitted: vi.fn(), finishBatch, finishBatchWithParticipantProjections: vi.fn().mockRejectedValue(new Error("stale command revision")), readCommand: vi.fn().mockResolvedValue(current), readCurrent: vi.fn().mockResolvedValue(current) };
    const result = await handleInviteSalesSessionParticipants({ invitationLedger: ledger, sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([participant]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([{ ...remoteParticipant("remote-1", "portal-1", "contact-1"), invitationStatus: "sent" as const }])), inviteParticipants }) }, diagnostics: { record: vi.fn() } }, { customerId: "customer-1", sessionId: session.id, actor, body: { ...explicitInviteBody(participant, "invite", commandId) } });
    expect(result).toMatchObject({ status: 409, body: { code: "command_replayed", commandId, outcome: "blocked" } });
    expect(ledger.finishBatchWithParticipantProjections).toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(inviteParticipants).not.toHaveBeenCalled(); expect(ledger.readCommand).toHaveBeenCalledWith("customer-1", commandId);
  });
});
