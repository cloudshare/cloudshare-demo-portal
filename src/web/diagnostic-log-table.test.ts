import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiagnosticLogTable } from "./diagnostic-log-table";

describe("DiagnosticLogTable", () => {
  it("renders a separate Customer column for score-related exam-attempt rows", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-1",
            occurredAt: "2026-06-21T10:00:00.000Z",
            level: "info",
            source: "runtime",
            operation: "exam_attempt.score.retrieve",
            outcome: "success",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-1", email: "candidate@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-1" },
            message: "Score retrieved successfully",
            correlationId: "corr-123",
            candidateEmail: "candidate@helioscx.demo",
            examId: "exam-1",
            examAttemptId: "attempt-1",
            response: { scoreAvailable: true, percentComplete: 80 },
          },
        ],
        expandedDiagnosticId: null,
        onToggleExpanded: () => {},
      }),
    );

    expect(html).toContain(">Customer<");
    expect(html).toContain(">customer-helios<");
  });
});
