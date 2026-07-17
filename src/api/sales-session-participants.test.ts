import { describe, expect, it, vi } from "vitest";
import { handleInviteSalesSessionParticipants, handleListSalesSessionParticipants, handleRegisterSalesSessionParticipants } from "./sales-session-participants";

describe("Sales Session participant invitation", () => {
  it("maps selected portal participant IDs to the persisted customer-scoped CloudShare IDs before inviting", async () => {
    const inviteParticipants = vi.fn().mockResolvedValue({ request: { method: "POST", path: "/sales/remote-sales-1/participants/invite" }, response: { status: 200 } });
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) },
      records: { findContact: vi.fn() },
      participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([{ id: "portal-participant-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-1", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() }]) },
      connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: [{ id: "remote-participant-1" }], request: {}, response: {} }), inviteParticipants }) },
    }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { participantIds: ["portal-participant-1"] } });

    expect(result.status).toBe(200);
    expect(inviteParticipants).toHaveBeenCalledWith("remote-sales-1", ["remote-participant-1"]);
    expect(JSON.stringify(result.body)).not.toContain("remote-participant-1");
  });

  it("does not call CloudShare when a portal participant is not registered for this customer Session", async () => {
    const inviteParticipants = vi.fn();
    const result = await handleInviteSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) }, records: { findContact: vi.fn() }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn(), inviteParticipants }) },
    }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { participantIds: ["foreign-portal-participant"] } });

    expect(result.status).toBe(404);
    expect(inviteParticipants).not.toHaveBeenCalled();
  });

  it("admits only active Contacts belonging to the Session Opportunity", async () => {
    const registerParticipants = vi.fn();
    const result = await handleRegisterSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) }, records: { findContact: vi.fn().mockResolvedValue({ id: "contact-foreign", opportunityId: "opportunity-2", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null }) }, participants: { save: vi.fn(), list: vi.fn() }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants, listParticipants: vi.fn(), inviteParticipants: vi.fn() }) } }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { contactIds: ["contact-foreign"] } });
    expect(result.status).toBe(404); expect(registerParticipants).not.toHaveBeenCalled();
  });

  it("persists the Contact-to-CloudShare participant mapping after registration", async () => {
    const save = vi.fn();
    const registerParticipants = vi.fn().mockResolvedValue({ participants: [{ id: "remote-participant-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null }], request: {}, response: {} });
    const result = await handleRegisterSalesSessionParticipants({
      sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) },
      records: { findContact: vi.fn().mockResolvedValue({ id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null }) },
      participants: { save, list: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants, listParticipants: vi.fn().mockResolvedValue({ participants: [], request: {}, response: {} }), inviteParticipants: vi.fn() }) },
    }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { contactIds: ["contact-1"] } });

    expect(result.status).toBe(201);
    expect(registerParticipants).toHaveBeenCalledWith("remote-sales-1", [{ firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" }]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-1" }));
    expect(JSON.stringify(result.body)).not.toContain("remote-participant-1");
  });

  it("repairs a failed local registration save from the existing CloudShare participant on retry without registering twice", async () => {
    const remoteParticipant = { id: "remote-participant-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null };
    const registerParticipants = vi.fn().mockResolvedValue({ participants: [remoteParticipant], request: {}, response: {} });
    const listParticipants = vi.fn().mockResolvedValueOnce({ participants: [], request: {}, response: {} }).mockResolvedValueOnce({ participants: [remoteParticipant], request: {}, response: {} });
    const save = vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValue(undefined);
    const deps = {
      sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) },
      records: { findContact: vi.fn().mockResolvedValue({ id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null }) },
      participants: { save, list: vi.fn().mockResolvedValue([]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) },
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants, listParticipants, inviteParticipants: vi.fn() }) },
    };
    const request = { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin" as const, id: "admin-1", email: "sales-admin@certalis.demo" }, body: { contactIds: ["contact-1"] } };

    expect((await handleRegisterSalesSessionParticipants(deps, request)).status).toBe(502);
    const retry = await handleRegisterSalesSessionParticipants(deps, request);

    expect(retry.status).toBe(201);
    expect(registerParticipants).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-1" }));
  });

  it("projects only persisted registered participants", async () => {
    const diagnostics = { record: vi.fn() };
    const save = vi.fn();
    const participant = { id: "portal-participant-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-1", invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, cloudShareEnvironmentId: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    const listed = await handleListSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC" }) }, records: { findContact: vi.fn().mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" }) }, participants: { save, list: vi.fn().mockResolvedValue([participant]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), inviteParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: [{ id: "remote-participant-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", invitationStatus: "sent", invitedBy: null, participationStatus: "inProgress", firstJoined: "2026-07-17T09:05:00Z", envStatus: "running", environmentId: "server-only-environment-1" }], request: {}, response: {} }) }) }, diagnostics }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" } });
    expect(listed).toMatchObject({ status: 200, body: { participants: [{ id: "portal-participant-1", firstName: "Ada", invitationStatus: "sent" }] } }); expect(save).toHaveBeenCalledWith(expect.objectContaining({ cloudShareEnvironmentId: "server-only-environment-1" })); expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ externalIds: expect.objectContaining({ environmentId: "server-only-environment-1" }) })); expect(JSON.stringify(listed.body)).not.toContain("remote-participant-1"); expect(JSON.stringify(listed.body)).not.toContain("server-only-environment-1");
  });

  it("marks a persisted participant as needing attention when CloudShare no longer returns its mapped participant", async () => {
    const diagnostics = { record: vi.fn() };
    const audit = { write: vi.fn() };
    const participant = { id: "portal-participant-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-1", invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    const listed = await handleListSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC" }) }, records: { findContact: vi.fn().mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" }) }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([participant]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), inviteParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: [], request: {}, response: {} }) }) }, diagnostics, audit }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" } });

    expect(listed).toMatchObject({ status: 200, body: { participants: [{ id: "portal-participant-1", needsAttention: true, monitoringMessage: "CloudShare no longer returned this registered participant. Do not resend; investigate the correlated diagnostics." }] } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", operation: "sales.demo_session.participants.reconciled", details: expect.objectContaining({ missingCloudShareParticipantCount: 1 }) }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }));
    expect(JSON.stringify(listed.body)).not.toContain("remote-participant-1");
  });

  it("returns a correlated, actionable failure without leaking a CloudShare participant identifier", async () => {
    const diagnostics = { record: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) }, records: { findContact: vi.fn() }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([{ id: "portal-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-secret", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() }]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: [{ id: "remote-participant-secret" }], request: {}, response: {} }), inviteParticipants: vi.fn().mockRejectedValue(new Error("offline")) }) }, diagnostics }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { participantIds: ["portal-1"] } });
    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare could not send the selected native invitations.", correlationId: expect.any(String) } }); expect(JSON.stringify(result.body)).not.toContain("remote-participant-secret"); expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales.participants" }) }));
  });

  it("rejects a selected persisted mapping absent from a fresh CloudShare participant read", async () => {
    const inviteParticipants = vi.fn(); const diagnostics = { record: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) }, records: { findContact: vi.fn() }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([{ id: "portal-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-secret", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() }]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: [], request: {}, response: {} }), inviteParticipants }) }, diagnostics }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { participantIds: ["portal-1"] } });
    expect(result).toMatchObject({ status: 409, body: { error: expect.stringContaining("need attention"), correlationId: expect.any(String) } });
    expect(inviteParticipants).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ failureMode: "participant_mapping_missing_from_cloudshare" }) }));
    expect(JSON.stringify(result.body)).not.toContain("remote-participant-secret");
  });

  it("writes a separate string-keyed participant and environment correlation record for every reconciled mapping", async () => {
    const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const stored = ["1", "2"].map((suffix) => ({ id: `portal-${suffix}`, customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: `contact-${suffix}`, cloudShareParticipantId: `remote-${suffix}`, invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, cloudShareEnvironmentId: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() }));
    const result = await handleListSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC" }) }, records: { findContact: vi.fn().mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" }) }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue(stored) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), inviteParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: ["1", "2"].map((suffix) => ({ id: `remote-${suffix}`, firstName: "Ada", lastName: "Lovelace", email: `ada-${suffix}@example.test`, invitationStatus: "sent", invitedBy: null, participationStatus: "inProgress", firstJoined: null, environmentId: `environment-${suffix}`, envStatus: "running" })), request: {}, response: {} }) }) }, diagnostics, audit }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" } });
    expect(result.status).toBe(200);
    for (const suffix of ["1", "2"]) { expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ operation: "sales.demo_session.participant.reconciled", externalIds: expect.objectContaining({ cloudShareParticipantId: `remote-${suffix}`, environmentId: `environment-${suffix}` }) })); expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "sales.demo_session.participant.reconciled", details: expect.objectContaining({ cloudShareParticipantId: `remote-${suffix}`, environmentId: `environment-${suffix}` }) })); }
    expect(JSON.stringify(result.body)).not.toContain("remote-1"); expect(JSON.stringify(result.body)).not.toContain("environment-1");
  });
});
