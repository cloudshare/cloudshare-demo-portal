import { describe, expect, it } from "vitest";
import { buildEventRecordRowKey } from "./admin-console-state";

describe("event log row key", () => {
  it("stays unique when multiple events share the same eventId", () => {
    expect(
      buildEventRecordRowKey(
        { eventId: "corr-1", type: "event.one", occurredAt: "2026-06-15T10:00:00.000Z" },
        0,
      ),
    ).not.toBe(
      buildEventRecordRowKey(
        { eventId: "corr-1", type: "event.one", occurredAt: "2026-06-15T10:00:00.000Z" },
        1,
      ),
    );
  });
});
