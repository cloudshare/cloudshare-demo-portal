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
    expect(html).toContain(">Event<");
    expect(html).toContain(">Support anchors<");
    expect(html).toContain(">Correlation and evidence<");
    expect(html).toContain('aria-label="Expand diagnostic entry diag-summary"');
  });

  it("canonicalises duplicate experience identifiers in CloudShare ID displays without hiding distinct values", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-promoted",
            occurredAt: "2026-06-21T09:55:00.000Z",
            level: "info",
            source: "runtime",
            operation: "exam_attempt.score.retrieve",
            outcome: "success",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-0", email: "candidate0@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-0" },
            message: "Score retrieved successfully",
            correlationId: "corr-promoted",
            candidateEmail: "candidate0@helioscx.demo",
            examId: "exam-0",
            examAttemptId: "attempt-0",
            externalIds: {
              trainingId: "EXtraining-0",
              participantId: "participant-0",
            },
          },
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

    expect(html).toContain("experienceId: EXtraining-0");
    expect(html).toContain("participantId: participant-0");
    expect(html).not.toContain("trainingId: EXtraining-0");
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

  it("renders support hints and quick facts above raw diagnostic evidence in the expanded view", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-hints",
            occurredAt: "2026-06-21T10:00:00.000Z",
            level: "warn",
            source: "cloudshare-webhook",
            operation: "cloudshare.webhook.verify_signature",
            outcome: "failure",
            customerId: "customer-helios",
            actor: { type: "system" },
            subject: { type: "customer", id: "customer-helios" },
            message: "CloudShare webhook signature did not match",
            correlationId: "corr-hint",
            candidateEmail: null,
            examId: null,
            examAttemptId: null,
            request: {
              method: "POST",
              path: "/api/webhooks/cloudshare/{webhookPathToken}",
            },
            details: {
              integrationSurface: "cloudshare.v3.webhook",
              signaturePresent: true,
              signatureMatched: false,
              failureMode: "invalid_signature",
              responseBody: {
                loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
              },
            },
          },
        ],
        expandedDiagnosticId: "diag-hints",
        onToggleExpanded: () => {},
      }),
    );

    expect(html).toContain("Support hints");
    expect(html).toContain("Webhook signature mismatch");
    expect(html).toContain("Quick facts");
    expect(html).toContain("cloudshare.v3.webhook");
    expect(html).toContain("POST /api/webhooks/cloudshare/{webhookPathToken}");
    expect(html).toContain("Correlation");
    expect(html).toContain("Request");
    expect(html).toContain("admin-evidence");
  });

  it("preserves the expanded evidence order for support investigations", () => {
    const html = renderToStaticMarkup(
      createElement(DiagnosticLogTable, {
        entries: [
          {
            id: "diag-order",
            occurredAt: "2026-06-21T10:00:00.000Z",
            level: "warn",
            source: "runtime",
            operation: "exam_attempt.resume",
            outcome: "failure",
            customerId: "customer-helios",
            actor: { type: "candidate", id: "candidate-1", email: "candidate@helioscx.demo" },
            subject: { type: "exam_attempt", id: "attempt-1" },
            message: "Exam resume failed",
            correlationId: "corr-order",
            candidateEmail: "candidate@helioscx.demo",
            examId: "exam-1",
            examAttemptId: "attempt-1",
            externalIds: {
              environmentId: "env-1",
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
              failureMode: "http_status",
            },
          },
        ],
        expandedDiagnosticId: "diag-order",
        onToggleExpanded: () => {},
      }),
    );

    expect(html.indexOf("<strong>Support hints</strong>")).toBeLessThan(html.indexOf("<strong>Quick facts</strong>"));
    expect(html.indexOf("<strong>Quick facts</strong>")).toBeLessThan(html.indexOf("<strong>External IDs</strong>"));
    expect(html.indexOf("<strong>External IDs</strong>")).toBeLessThan(html.indexOf("<strong>Request</strong>"));
    expect(html.indexOf("<strong>Request</strong>")).toBeLessThan(html.indexOf("<strong>Response</strong>"));
    expect(html.indexOf("<strong>Response</strong>")).toBeLessThan(html.indexOf("<strong>Details</strong>"));
  });
});
