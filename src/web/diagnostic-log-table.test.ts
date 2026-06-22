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
        onOpenExamAttempt: () => {},
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
    expect(html).toContain("Surface: cloudshare.v4.environment");
    expect(html).toContain("environmentId: env-1");
    expect(html).toContain("POST /api/exam/resume");
    expect(html).toContain("HTTP 502");
    expect(html).toContain('aria-label="Filter Support Diagnostics by ExamAttempt attempt-1"');
  });

  it("canonicalises duplicate experience identifiers in CloudShare ID displays without hiding distinct values", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-deduped",
            occurredAt: "2026-06-21T10:00:00.000Z",
            level: "info",
            source: "runtime",
            operation: "exam_attempt.score.retrieve",
            outcome: "success",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-1", email: "candidate@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-1" },
            message: "Score retrieved successfully",
            correlationId: "corr-deduped",
            candidateEmail: "candidate@helioscx.demo",
            examId: "exam-1",
            examAttemptId: "attempt-1",
            externalIds: {
              trainingId: "exp-shared",
              experienceId: "exp-shared",
              salesId: "exp-shared",
              participantId: "participant-1",
            },
          },
          {
            id: "diag-distinct",
            occurredAt: "2026-06-21T10:05:00.000Z",
            level: "info",
            source: "runtime",
            operation: "exam_attempt.score.retrieve",
            outcome: "success",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-2", email: "candidate2@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-2" },
            message: "Score retrieved successfully",
            correlationId: "corr-distinct",
            candidateEmail: "candidate2@helioscx.demo",
            examId: "exam-2",
            examAttemptId: "attempt-2",
            externalIds: {
              trainingId: "training-2",
              experienceId: "experience-2",
              salesId: "sales-2",
            },
          },
        ],
        expandedDiagnosticId: "diag-deduped",
        onToggleExpanded: () => {},
      }),
    );

    expect(html).toContain("experienceId: exp-shared");
    expect(html).toContain("participantId: participant-1");
    expect(html).not.toContain("trainingId: exp-shared");
    expect(html).not.toContain("salesId: exp-shared");
    expect(html).toContain("trainingId: training-2");
    expect(html).toContain("experienceId: experience-2");
    expect(html).toContain("salesId: sales-2");
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
