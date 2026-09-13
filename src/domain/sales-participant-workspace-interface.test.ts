import { describe, expect, it, vi } from "vitest";
import type { SalesParticipantWorkspace } from "./sales-participant-workspace";
import { createSalesParticipantWorkspace } from "@/application/sales-session-participants";

describe("SalesParticipantWorkspace application boundary", () => {
  it("exposes only page reads and safe invitation submission", async () => {
    const workspace: SalesParticipantWorkspace = {
      readPage: vi.fn().mockResolvedValue(null),
      submitInvitation: vi.fn().mockResolvedValue({ status: 202, body: { outcome: "accepted", correlationId: "corr-1" } }),
    };
    const target = { participantId: "participant-1", intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: "revision-1" };
    const actor = { type: "admin", id: "admin-1", email: "admin@example.test" };
    await expect(workspace.submitInvitation({ customerId: "customer-1", sessionId: "session-1", actor, commandId: "command-1", targets: [target] })).resolves.toEqual({ status: 202, body: { outcome: "accepted", correlationId: "corr-1" } });
    expect(workspace.submitInvitation).toHaveBeenCalledWith({ customerId: "customer-1", sessionId: "session-1", actor, commandId: "command-1", targets: [target] });
    expect(Object.keys(workspace).sort()).toEqual(["readPage", "submitInvitation"]);
  });

  it("exercises invitation validation through the deep workspace interface", async () => {
    const readPage = vi.fn().mockResolvedValue(null);
    const workspace = createSalesParticipantWorkspace({
      reader: { readPage },
      invitationStore: {} as never,
      sessions: {} as never,
      records: {} as never,
      participants: {} as never,
      connections: {} as never,
    });

    await expect(workspace.submitInvitation({
      customerId: "customer-1",
      sessionId: "session-1",
      actor: { type: "admin", id: "admin-1", email: "admin@example.test" },
      commandId: "not-a-command-id",
      targets: [],
    })).resolves.toEqual({ status: 400, body: { error: "Provide a valid invitation command with ordered participant targets." } });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("composes the bounded base page with safe invitation feedback and server-projected actions", async () => {
    const readParticipantProjections = vi.fn().mockResolvedValue(new Map([["participant-1", {
      currentCommandId: "command-1", invitationOutcome: "confirmation_required", invitationReason: "confirmation_required", invitationCorrelationId: "corr-current",
      latestInvitationOutcome: "failed_retryable", latestInvitationReason: "not_dispatched", latestInvitationCorrelationId: "corr-latest",
    }]]));
    const workspace = createSalesParticipantWorkspace({
      reader: { readPage: vi.fn().mockResolvedValue({ total: 1, offset: 0, limit: 25, hasMore: false, participants: [{ id: "participant-1", participantRevision: "revision-1", name: "Ada", email: "ada@example.test", invitationStatus: "notSent", participationStatus: "pending", sessionEndsAt: "2026-12-01T12:00:00.000Z", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, launchOperation: null, environment: { value: null, source: "not_observed" }, environmentAttention: null }] }) },
      invitationStore: { readParticipantProjections } as never,
      sessions: {} as never, records: {} as never, participants: {} as never, connections: {} as never,
    });
    const page = await workspace.readPage({ customerId: "customer-1", sessionId: "session-1", query: "Ada", offset: 0, limit: 25, now: new Date("2026-09-01T00:00:00Z") });
    expect(readParticipantProjections).toHaveBeenCalledWith({ customerId: "customer-1", sessionId: "session-1", participantIds: ["participant-1"], at: new Date("2026-09-01T00:00:00Z") });
    expect(page?.participants[0]).toMatchObject({ currentCommandId: "command-1", latestInvitationCorrelationId: "corr-latest", primaryAction: "generate_launch", actionAvailability: { invite: { available: false, reason: "invitation_command_pending" } } });
  });
});
