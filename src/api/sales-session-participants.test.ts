import { describe, expect, it, vi } from "vitest";
import { CloudShareResponseError } from "@/integrations/cloudshare/errors";
import { handleInviteSalesSessionParticipants, handleListSalesSessionParticipants, handleRegisterSalesSessionParticipants } from "./sales-session-participants";

const actor = { type: "admin" as const, id: "admin-1", email: "sales-admin@certalis.demo" };
const session = { id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" as const, start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC" };
const contact = { id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null };
const correlationProperties = () => ({
  requiredKeys: ["certalisSalesParticipantId", "certalisOpportunityContactId"] as const,
  availableKeys: ["certalisSalesParticipantId", "certalisOpportunityContactId"],
  requests: [{ method: "GET", path: "/v4/sales/remote-sales-1/users/properties" }],
  responses: [{ status: 200, body: [] }],
  request: { method: "GET", path: "/v4/sales/remote-sales-1/users/properties" },
  response: { status: 200, body: [] },
});
const rosterEvidence = (participants: readonly unknown[]) => ({ participants, request: { method: "GET", path: "/v4/sales/remote-sales-1/participants", query: { offset: "0", limit: "100" } }, response: { status: 200, body: { count: participants.length, items: participants } } });
const remoteParticipant = (id: string, portalId?: string, contactId?: string, email = "ada@example.test") => ({
  id, firstName: "Ada", lastName: "Lovelace", email, invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, environmentId: null, envStatus: null,
  customProperties: portalId && contactId ? { certalisSalesParticipantId: portalId, certalisOpportunityContactId: contactId } : {},
});
const storedParticipant = (id = "portal-1", contactId = "contact-1", cloudShareParticipantId = "remote-1") => ({ id, customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: contactId, cloudShareParticipantId, invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, cloudShareEnvironmentId: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() });

describe("Sales Session participant invitation", () => {
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

  it("retains the completed roster exchange when its local participant read fails", async () => {
    const diagnostics = { record: vi.fn() };
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockRejectedValue(new Error("database unavailable")), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), ensureParticipantCorrelationProperties: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([])), inviteParticipants: vi.fn() }) }, diagnostics,
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { contactIds: [contact.id] } });

    expect(result.status).toBe(502);
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 200, body: expect.objectContaining({ items: [] }) }), details: expect.objectContaining({ failureMode: "participant_mapping_persistence", httpExchanges: expect.arrayContaining([expect.objectContaining({ request: expect.objectContaining({ method: "GET" }) })]) }) }));
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
    const remote = { ...remoteParticipant("provider-changed", "portal-1", contact.id), invitationStatus: "sent" as const, participationStatus: "inProgress" as const, environmentId: "environment-1", envStatus: "running" };
    const save = vi.fn();
    const result = await handleListSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn().mockResolvedValue(contact) }, participants: { list: vi.fn().mockResolvedValue([storedParticipant("portal-1", contact.id, "provider-old")]), save }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remote])) }) },
    }, { customerId: "customer-1", sessionId: session.id, actor });

    expect(result).toMatchObject({ status: 200, body: { participants: [{ id: "portal-1", invitationStatus: "sent", envStatus: "running" }] } });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ cloudShareParticipantId: "provider-changed", cloudShareEnvironmentId: "environment-1" }));
    expect(JSON.stringify(result.body)).not.toContain("provider-changed");
    expect(JSON.stringify(result.body)).not.toContain("environment-1");
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

  it("maps selected portal IDs to customer-scoped provider IDs before native invitation", async () => {
    const inviteParticipants = vi.fn().mockResolvedValue({ request: {}, response: { status: 200 } });
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1", "portal-1", "contact-1")])), inviteParticipants }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { participantIds: ["portal-1"] } });

    expect(result.status).toBe(200);
    expect(inviteParticipants).toHaveBeenCalledWith("remote-sales-1", ["remote-1"]);
    expect(JSON.stringify(result.body)).not.toContain("remote-1");
  });

  it("refuses an invite when the provider row no longer carries its exact Certalis identity pair", async () => {
    const inviteParticipants = vi.fn();
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue(session) }, records: { findContact: vi.fn() }, participants: { list: vi.fn().mockResolvedValue([storedParticipant()]), save: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), listParticipants: vi.fn().mockResolvedValue(rosterEvidence([remoteParticipant("remote-1")])), inviteParticipants }) },
    }, { customerId: "customer-1", sessionId: session.id, actor, body: { participantIds: ["portal-1"] } });

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
});
