import { describe, expect, it } from "vitest";
import { invitationResult, invitationScopeHash, type InvitationTargetOutcome } from "./sales-participant-invitation-ledger";

describe("Sales Participant invitation ledger", () => {
  it("binds command scope to customer, session, ordered targets and explicit preconditions", () => {
    const base = { customerId: "c1", sessionId: "s1", targets: [{ participantId: "p1", intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: "r1" }] };
    expect(invitationScopeHash(base)).toBe(invitationScopeHash(base));
    expect(invitationScopeHash(base)).not.toBe(invitationScopeHash({ ...base, customerId: "c2" }));
    expect(invitationScopeHash(base)).not.toBe(invitationScopeHash({ ...base, targets: [{ ...base.targets[0], intent: "resend" }] }));
  });

  it("does not bind idempotency scope to admission metadata", () => {
    const base = { customerId: "c1", sessionId: "s1", targets: [{ participantId: "p1", intent: "invite" as const, expectedInvitationStatus: "notSent" as const, participantRevision: "r1" }] };
    expect(invitationScopeHash({ ...base, commandId: "command-a", at: new Date("2026-01-01T00:00:00Z") } as never))
      .toBe(invitationScopeHash({ ...base, commandId: "command-b", at: new Date("2026-01-02T00:00:00Z") } as never));
  });

  it("reconstructs a closed safe aggregate and rejects arbitrary evidence", () => {
    const outcomes: InvitationTargetOutcome[] = [
      { participantId: "p1", outcome: "confirmed", reason: null },
      { participantId: "p2", outcome: "no_replay", reason: "Provider outcome is ambiguous; do not retry." },
    ];
    expect(invitationResult({ commandId: "cmd", outcomes, correlationId: "corr" })).toMatchObject({ outcome: "blocked", counts: { confirmed: 1, no_replay: 1 } });
    expect(() => invitationResult({ commandId: "cmd", outcomes: [{ participantId: "p", outcome: "provider_secret" as never, reason: null }], correlationId: null })).toThrow();
  });

  it.each([
    [null, "in_progress"],
    ["no_replay", "blocked"],
    ["confirmation_required", "confirmation_required"],
    ["failed_retryable", "failed_retryable"],
    ["accepted_unconfirmed", "completed_with_unconfirmed"],
    ["confirmed_by_reconciliation", "completed"],
  ] as const)("projects %s to the contract aggregate %s", (targetOutcome, aggregate) => {
    expect(invitationResult({ commandId: "cmd", correlationId: "corr", outcomes: [
      { participantId: "p1", outcome: targetOutcome, reason: null },
    ] }).outcome).toBe(aggregate);
  });
});
