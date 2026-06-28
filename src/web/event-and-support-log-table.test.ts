import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventLogTable } from "./event-log-table";

const identityTimestamp = (value: string | null | undefined) => value ?? "-";

describe("EventLogTable", () => {
  it("renders a separate Customer column when an event payload carries customerId", () => {
    const html = renderToStaticMarkup(
      createElement(EventLogTable, {
        records: [
          {
            eventId: "corr-1",
            type: "cloudshare.schedule_exam.failed",
            occurredAt: "2026-06-21T12:00:00.000Z",
            payload: {
              customerId: "customer-helios",
              examAttemptId: "attempt-1",
            },
          },
        ],
        formatUtcTimestamp: identityTimestamp,
        buildRowKey: (record: { eventId: string }, index: number) => `${record.eventId}-${index}`,
      }),
    );

    expect(html).toContain(">Customer<");
    expect(html).toContain(">customer-helios<");
  });
});
