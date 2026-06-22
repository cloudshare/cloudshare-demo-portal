import { describe, expect, it } from "vitest";
import { deriveDiagnosticQuickFacts, deriveDiagnosticSupportHints } from "./diagnostic-support-hints";
import type { SupportDiagnosticEntry } from "./diagnostic-support-hints";

function makeEntry(overrides: Partial<SupportDiagnosticEntry> = {}): SupportDiagnosticEntry {
  return {
    id: "diag-1",
    occurredAt: "2026-06-21T10:00:00.000Z",
    level: "warn",
    source: "runtime",
    operation: "exam_attempt.resume",
    outcome: "failure",
    customerId: "customer-helios",
    actor: { type: "candidate", id: "candidate-1", email: "candidate@helioscx.demo" },
    subject: { type: "exam_attempt", id: "attempt-1" },
    message: "Diagnostic failed",
    correlationId: "corr-123",
    candidateEmail: "candidate@helioscx.demo",
    examId: "exam-1",
    examAttemptId: "attempt-1",
    externalIds: null,
    request: null,
    response: null,
    details: null,
    ...overrides,
  };
}

describe("deriveDiagnosticSupportHints", () => {
  it("explains webhook signature mismatch with separate stored-secret and raw-body checks", () => {
    const hints = deriveDiagnosticSupportHints(
      makeEntry({
        source: "cloudshare-webhook",
        operation: "cloudshare.webhook.verify_signature",
        message: "CloudShare webhook signature did not match",
        details: {
          signaturePresent: true,
          signatureMatched: false,
          signatureScheme: "HMAC-SHA256 base64 over exact raw request body",
          storedWebhookSecretLength: 24,
          rawBodySha256: "abc123",
        },
      }),
    );

    expect(hints).toEqual([
      expect.objectContaining({
        title: "Webhook signature mismatch",
        body: expect.stringContaining("stored CloudShare Connection webhook secret"),
      }),
    ]);
    expect(hints[0]?.body).toContain("exact raw body");
  });

  it("explains that a missing webhook signature was not verifiable as CloudShare-originated", () => {
    const hints = deriveDiagnosticSupportHints(
      makeEntry({
        source: "cloudshare-webhook",
        operation: "cloudshare.webhook.receive",
        message: "CloudShare webhook rejected: missing signature",
        details: {
          trustGateOutcome: "missing_signature",
          signaturePresent: false,
        },
      }),
    );

    expect(hints).toEqual([
      expect.objectContaining({
        title: "Webhook request was not verifiable",
        body: expect.stringContaining("not verifiable as CloudShare-originated"),
      }),
    ]);
  });

  it("distinguishes Guided Journey participant-correlation gaps from CloudShare score retrieval failures", () => {
    const correlationHints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "exam_attempt.score.correlate_environment",
        message: "Score retrieval failed: could not correlate CloudShare environment participant",
        details: {
          attemptedOperation: "resolve_training_participant",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/training-1/students",
          failureMode: "missing_participant_id",
        },
      }),
    );
    const responseHints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "exam_attempt.score.retrieve",
        message: "Score retrieval failed",
        details: {
          attemptedOperation: "get_guided_journey_progress",
          integrationSurface: "cloudshare.v4.guided_journey.progress",
          method: "GET",
          path: "/guided-journey/progress/exp-1/student-1",
          failureMode: "unexpected_response",
          responseStatus: 200,
        },
      }),
    );

    expect(correlationHints[0]).toEqual(
      expect.objectContaining({
        title: "Guided Journey participant could not be correlated",
      }),
    );
    expect(responseHints[0]).toEqual(
      expect.objectContaining({
        title: "Guided Journey returned an unexpected payload",
      }),
    );
  });

  it("keeps support hints redaction-safe even when admin-only evidence contains a loginUrl", () => {
    const hints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "exam_attempt.score.retrieve",
        details: {
          attemptedOperation: "get_guided_journey_progress",
          integrationSurface: "cloudshare.v4.guided_journey.progress",
          method: "GET",
          path: "/guided-journey/progress/exp-1/student-1",
          failureMode: "http_status",
          responseStatus: 502,
          responseBody: {
            loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
          },
        },
      }),
    );

    expect(JSON.stringify(hints)).not.toContain("admin-evidence");
    expect(JSON.stringify(hints)).not.toContain("loginUrl");
  });
});

describe("deriveDiagnosticQuickFacts", () => {
  it("surfaces scan-friendly quick facts for CloudShare failures and attempt status issues", () => {
    const facts = deriveDiagnosticQuickFacts(
      makeEntry({
        operation: "exam_attempt.enter",
        details: {
          integrationSurface: "portal.enter_redirect",
          method: "GET",
          path: "/enter",
          failureMode: "invalid_status",
          currentStatus: "completed",
          environmentStatus: "suspended",
          responseStatus: 403,
        },
      }),
    );

    expect(facts).toEqual(
      expect.arrayContaining([
        { label: "ExamAttempt", value: "attempt-1" },
        { label: "Surface", value: "portal.enter_redirect" },
        { label: "Request", value: "GET /enter" },
        { label: "HTTP", value: "403" },
        { label: "Failure mode", value: "invalid_status" },
        { label: "Attempt status", value: "completed" },
        { label: "Environment state", value: "suspended" },
        { label: "Correlation", value: "corr-123" },
      ]),
    );
  });
});
