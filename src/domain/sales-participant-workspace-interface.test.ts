import { describe, expect, it, vi } from "vitest";
import type { SalesParticipantWorkspace } from "./sales-participant-workspace";

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
});
