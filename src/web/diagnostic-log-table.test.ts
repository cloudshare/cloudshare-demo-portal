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

  it("renders support anchors and request/response summary fields in the primary row", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-summary",
            occurredAt: "2026-06-21T10:00:00.000Z",
            level: "warn",
            source: "runtime",
            operation: "exam_attempt.resume",
            outcome: "failure",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-1", email: "candidate@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-1" },
            message: "Exam resume failed",
            correlationId: "corr-123",
            candidateEmail: "candidate@helioscx.demo",
            examId: "exam-1",
            examAttemptId: "attempt-1",
            externalIds: {
              environmentId: "env-1",
              trainingId: "training-1",
            },
            request: {
              method: "POST",
              path: "/api/exam/resume",
            },
            response: {
              status: 502,
            },
            details: {
              integrationSurface: "cloudshare.v4.environment",
            },
          },
        ],
        expandedDiagnosticId: null,
        onToggleExpanded: () => {},
      }),
    );

    expect(html).toContain(">Exam<");
    expect(html).toContain(">Attempt<");
    expect(html).toContain(">CloudShare IDs<");
    expect(html).toContain(">Request / Response<");
    expect(html).toContain("candidate (candidate@helioscx.demo)");
    expect(html).toContain("exam_attempt (attempt-1)");
    expect(html).toContain(">exam-1<");
    expect(html).toContain(">attempt-1<");
    expect(html).toContain("environmentId: env-1");
    expect(html).toContain("POST /api/exam/resume");
    expect(html).toContain("HTTP 502");
  });

  it("truncates oversized structured detail payloads in the expanded view", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-oversized",
            occurredAt: "2026-06-21T10:00:00.000Z",
            level: "warn",
            source: "runtime",
            operation: "exam_attempt.resume",
            outcome: "failure",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-1", email: "candidate@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-1" },
            message: "Exam resume failed",
            correlationId: "corr-oversized",
            candidateEmail: "candidate@helioscx.demo",
            examId: "exam-1",
            examAttemptId: "attempt-1",
            details: {
              payload: "x".repeat(20_000),
            },
          },
        ],
        expandedDiagnosticId: "diag-oversized",
        onToggleExpanded: () => {},
      }),
    );

    expect(html).toContain("Detail output truncated in the table view");
    expect(html).toContain("... truncated");
    expect(html).not.toContain("x".repeat(15_000));
  });
});
