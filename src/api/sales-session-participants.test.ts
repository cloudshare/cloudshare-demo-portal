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
      deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn(), inviteParticipants }) },
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

  it("projects only persisted registered participants", async () => {
    const diagnostics = { record: vi.fn() };
    const participant = { id: "portal-participant-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-1", invitationStatus: "notSent" as const, invitedBy: null, participationStatus: "pending" as const, firstJoined: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    const listed = await handleListSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC" }) }, records: { findContact: vi.fn().mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" }) }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([participant]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), inviteParticipants: vi.fn(), listParticipants: vi.fn().mockResolvedValue({ participants: [{ id: "remote-participant-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", invitationStatus: "sent", invitedBy: null, participationStatus: "inProgress", firstJoined: "2026-07-17T09:05:00Z", envStatus: "running" }], request: {}, response: {} }) }) }, diagnostics }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" } });
    expect(listed).toMatchObject({ status: 200, body: { participants: [{ id: "portal-participant-1", firstName: "Ada", invitationStatus: "sent" }] } }); expect(JSON.stringify(listed.body)).not.toContain("remote-participant-1");
  });

  it("returns a correlated, actionable failure without leaking a CloudShare participant identifier", async () => {
    const diagnostics = { record: vi.fn() };
    const result = await handleInviteSalesSessionParticipants({ sessions: { findById: vi.fn().mockResolvedValue({ id: "session-1", opportunityId: "opportunity-1", cloudShareSalesExperienceId: "remote-sales-1", operationalStatus: "active" }) }, records: { findContact: vi.fn() }, participants: { save: vi.fn(), list: vi.fn().mockResolvedValue([{ id: "portal-1", customerId: "customer-1", salesDemoSessionId: "session-1", opportunityContactId: "contact-1", cloudShareParticipantId: "remote-participant-secret", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null, environmentStatus: null, lastReconciledAt: new Date(), createdAt: new Date(), updatedAt: new Date() }]) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "customer-1" }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), registerParticipants: vi.fn(), listParticipants: vi.fn(), inviteParticipants: vi.fn().mockRejectedValue(new Error("offline")) }) }, diagnostics }, { customerId: "customer-1", sessionId: "session-1", actor: { type: "admin", id: "admin-1", email: "sales-admin@certalis.demo" }, body: { participantIds: ["portal-1"] } });
    expect(result).toMatchObject({ status: 502, body: { error: "CloudShare could not send the selected native invitations.", correlationId: expect.any(String) } }); expect(JSON.stringify(result.body)).not.toContain("remote-participant-secret"); expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", details: expect.objectContaining({ integrationSurface: "cloudshare.v4.sales.participants" }) }));
  });
});
