import { describe, expect, it, vi } from "vitest";
import type { SalesParticipantWorkspace } from "@/domain/sales-participant-workspace";
import { handleInviteSalesSessionParticipants } from "./sales-session-participants";

const actor = { type: "admin" as const, id: "admin-1", email: "admin@example.test" };
const target = { participantId: "participant-1", intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: "revision-1" };

describe("Sales Session participant invitation HTTP boundary", () => {
  it("rejects malformed commands without invoking the workspace", async () => {
    const submitInvitation = vi.fn();
    const result = await handleInviteSalesSessionParticipants({ workspace: { submitInvitation } as unknown as SalesParticipantWorkspace }, { customerId: "customer-1", sessionId: "session-1", actor, body: {} });
    expect(result).toEqual({ status: 400, body: { error: "Provide a valid invitation command with ordered participant targets." } });
    expect(submitInvitation).not.toHaveBeenCalled();
  });

  it("maps the validated request and returns the workspace result", async () => {
    const response = { status: 202, body: { outcome: "accepted" as const, correlationId: "corr-1" } };
    const submitInvitation = vi.fn().mockResolvedValue(response);
    const workspace = { submitInvitation } as unknown as SalesParticipantWorkspace;
    await expect(handleInviteSalesSessionParticipants({ workspace }, { customerId: "customer-1", sessionId: "session-1", actor, body: { commandId: "00000000-0000-4000-8000-000000000001", targets: [target] } })).resolves.toEqual(response);
    expect(submitInvitation).toHaveBeenCalledTimes(1);
    expect(submitInvitation).toHaveBeenCalledWith({ customerId: "customer-1", sessionId: "session-1", actor, commandId: "00000000-0000-4000-8000-000000000001", targets: [target] });
  });

  it("rejects 101 invitation targets without dispatching or returning submitted evidence", async () => {
    const submitInvitation = vi.fn();
    const targets = Array.from({ length: 101 }, (_, index) => ({
      ...target,
      participantId: `participant-${index}`,
      participantRevision: "private-revision-evidence",
    }));
    const result = await handleInviteSalesSessionParticipants(
      { workspace: { submitInvitation } as unknown as SalesParticipantWorkspace },
      { customerId: "customer-1", sessionId: "session-1", actor, body: {
        commandId: "00000000-0000-4000-8000-000000000001", targets,
      } },
    );
    expect(result).toEqual({ status: 400, body: { error: "Provide a valid invitation command with ordered participant targets." } });
    expect(submitInvitation).not.toHaveBeenCalled();
  });
});
