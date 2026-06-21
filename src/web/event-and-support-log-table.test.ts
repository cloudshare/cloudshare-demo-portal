import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventLogTable } from "./event-log-table";
import { SupportLogTable } from "./support-log-table";

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

describe("SupportLogTable", () => {
  it("renders a separate Customer column when a support record field carries customerId", () => {
    const html = renderToStaticMarkup(
      createElement(SupportLogTable, {
        records: [
          {
            timestamp: "2026-06-21T12:05:00.000Z",
            level: "warn",
            message: "candidate score retrieval failed",
            fields: {
              customerId: "customer-helios",
              operation: "candidate_score_retrieval",
              correlationId: "corr-2",
              method: "GET",
              path: "/guided-journey/progress/exp-1/student-1",
              failureMode: "transport",
            },
          },
        ],
        formatUtcTimestamp: identityTimestamp,
      }),
    );

    expect(html).toContain(">Customer<");
    expect(html).toContain(">customer-helios<");
  });
});
