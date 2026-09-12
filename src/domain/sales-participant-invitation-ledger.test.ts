import { describe, expect, it } from "vitest";
import { invitationResult, invitationScopeHash, type InvitationTargetOutcome } from "./sales-participant-invitation-ledger";

describe("Sales Participant invitation ledger", () => {
  it("binds command scope to customer, session, ordered targets and explicit preconditions", () => {
    const base = { customerId: "c1", sessionId: "s1", targets: [{ participantId: "p1", intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: "r1" }] };
    expect(invitationScopeHash(base)).toBe(invitationScopeHash(base));
    expect(invitationScopeHash(base)).not.toBe(invitationScopeHash({ ...base, customerId: "c2" }));
    expect(invitationScopeHash(base)).not.toBe(invitationScopeHash({ ...base, targets: [{ ...base.targets[0], intent: "resend" }] }));
  });

  it("reconstructs a closed safe aggregate and rejects arbitrary evidence", () => {
    const outcomes: InvitationTargetOutcome[] = [
      { participantId: "p1", outcome: "confirmed", reason: null },
      { participantId: "p2", outcome: "no_replay", reason: "Provider outcome is ambiguous; do not retry." },
    ];
    expect(invitationResult({ commandId: "cmd", outcomes, correlationId: "corr" })).toMatchObject({ outcome: "blocked", counts: { confirmed: 1, no_replay: 1 } });
    expect(() => invitationResult({ commandId: "cmd", outcomes: [{ participantId: "p", outcome: "provider_secret" as never, reason: null }], correlationId: null })).toThrow();
  });
});
