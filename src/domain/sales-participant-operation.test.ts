import { describe, expect, it } from "vitest";
import { operationStateForResult, retryDispositionForDispatch } from "./sales-participant-operation";

describe("Sales Participant operation state", () => {
  it("marks only an after-dispatch ambiguity as no-replay", () => {
    expect(retryDispositionForDispatch("not_started")).toBe("retryable");
    expect(retryDispositionForDispatch("acknowledged")).toBe("retryable");
    expect(retryDispositionForDispatch("ambiguous_after_dispatch")).toBe("no_replay");
  });

  it("creates a durable safe result projection without provider evidence", () => {
    const now = new Date("2026-09-12T15:00:00.000Z");
    expect(operationStateForResult({ customerId: "customer-a", participantId: "p1", capability: "email", correlationId: "corr-1", disposition: "no_replay", resultMetadata: { status: 502, failureMode: "confirmation" }, now })).toEqual({
      customerId: "customer-a", participantId: "p1", capability: "email", disposition: "no_replay", correlationId: "corr-1", resultMetadata: { status: 502, failureMode: "confirmation" }, startedAt: now, updatedAt: now, confirmedAt: null,
    });
  });
});
