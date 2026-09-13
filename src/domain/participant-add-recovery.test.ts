import { describe, expect, it } from "vitest";
import { classifyParticipantAddRecovery, participantAddRecovery } from "./participant-add-recovery";

describe("participant add recovery policy", () => {
  it("retries only explicit pre-dispatch failures quickly", () => {
    expect(classifyParticipantAddRecovery({ code: "participant_add_retryable", dispatchOutcome: "not_dispatched" })).toBe("quick_retry");
    expect(classifyParticipantAddRecovery({ code: "participant_add_retryable" })).toBe("stop");
    expect(participantAddRecovery.oauthRetryDelaysMs).toEqual([2_000, 5_000, 10_000]);
  });
  it("classifies ambiguity as read-only reconciliation and uses bounded recovered backoff", () => {
    expect(classifyParticipantAddRecovery({ code: "participant_add_no_replay" })).toBe("reconcile_only");
    expect(participantAddRecovery.ambiguousReconciliationDelayMs).toBe(120_000);
    expect(participantAddRecovery.reconciledRetryDelaysMs).toEqual([120_000, 300_000, 600_000, 900_000]);
  });
});
