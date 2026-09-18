import { describe, expect, it } from "vitest";
import { createInMemorySalesParticipantExtensionCommandStore } from "./in-memory-sales-participant-extension-command";

describe("Sales participant extension command store", () => {
  it("admits once, fences dispatch, and preserves confirmed per-target expiry", async () => {
    const store = createInMemorySalesParticipantExtensionCommandStore();
    const target = { participantId: "p1", participantRevision: "r1", environmentId: "v3-env-1", preExpiry: "2026-09-18T10:00:00Z" };
    const first = await store.admit({ customerId: "customer-a", sessionId: "session-a", commandId: "cmd-1", targetEnd: "2026-09-18T11:00:00Z", targets: [target] });
    expect(first.kind).toBe("new");
    expect((await store.admit({ customerId: "customer-a", sessionId: "session-a", commandId: "cmd-1", targetEnd: "2026-09-18T11:00:00Z", targets: [target] })).kind).toBe("existing");
    expect(await store.markDispatching({ customerId: "customer-a", commandId: "cmd-1", expectedRevision: 1 })).toBe(true);
    const settled = await store.settle({ customerId: "customer-a", commandId: "cmd-1", expectedRevision: 2, dispatchState: "settled", correlationId: "corr-1", targets: [{ participantId: "p1", outcome: "confirmed", reason: null, confirmedExpiry: "2026-09-19T10:00:00Z" }] });
    expect(settled.targets[0]).toMatchObject({ outcome: "confirmed", confirmedExpiry: "2026-09-19T10:00:00Z" });
    expect(await store.markDispatching({ customerId: "customer-a", commandId: "cmd-1", expectedRevision: 3 })).toBe(false);
  });
});
