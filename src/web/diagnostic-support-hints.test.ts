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
        operation: "cloudshare.webhook.verify_signature",
        message: "CloudShare webhook signature missing",
        details: {
          signaturePresent: false,
          signatureMatched: false,
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

  it("distinguishes Guided Journey participant-list failure modes from score retrieval failures", () => {
    const incompleteHints = deriveDiagnosticSupportHints(
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
    const participantHints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "exam_attempt.score.correlate_environment",
        message: "Score retrieval failed: could not correlate CloudShare environment participant",
        details: {
          attemptedOperation: "resolve_training_participant",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/training-1/students",
          failureMode: "missing_participant_id",
          participantEmail: "candidate@helioscx.demo",
          trainingId: "training-1",
        },
      }),
    );
    const participantListFailureHints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "exam_attempt.score.correlate_environment",
        message: "Score retrieval failed: could not correlate CloudShare environment participant",
        details: {
          attemptedOperation: "resolve_training_participant",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/training-1/students",
          failureMode: "http_status",
          responseStatus: 502,
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

    expect(incompleteHints[0]).toEqual(
      expect.objectContaining({
        title: "Guided Journey correlation data is incomplete",
      }),
    );
    expect(participantHints[0]).toEqual(
      expect.objectContaining({
        title: "Guided Journey participant could not be correlated",
      }),
    );
    expect(participantListFailureHints[0]).toEqual(
      expect.objectContaining({
        title: "CloudShare participant lookup failed",
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

  it("guides support when the local 429 fixture indicates likely requester-IP abuse protection", () => {
    const hints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "candidate_dashboard_environment_correlation",
        request: {
          method: "GET",
          path: "/v4/trainings/EXlocalRateLimit429/students",
        },
        response: {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: { code: "synthetic-429-code" },
        },
        details: {
          integrationSurface: "cloudshare.v4.training.participant_list",
          failureMode: "abuse_protection",
          responseStatus: 429,
        },
      }),
    );

    expect(hints).toEqual([
      expect.objectContaining({
        title: "CloudShare may have rate-limited the requester IP",
        body: "An error has occurred processing your request. It is possible that this request failed because the requester's IP address was placed on an abuse list and rate-limited. Please contact support@cloudshare.com for confirmation and assistance.",
      }),
    ]);
    expect(JSON.stringify(hints)).not.toContain("synthetic-429-code");
  });

  it.each([
    {
      label: "Guided Journey with a rate-limit classification",
      operation: "exam_attempt.score.retrieve",
      source: "guided-journey",
      surface: "cloudshare.v4.guided_journey.progress",
      failureMode: "rate_limit",
    },
    {
      label: "webhook verification with an unrelated classification",
      operation: "cloudshare.webhook.verify_signature",
      source: "cloudshare-webhook",
      surface: "cloudshare.webhook",
      failureMode: "signature_mismatch",
    },
    {
      label: "candidate correlation with an unknown classification",
      operation: "candidate_dashboard_environment_correlation",
      source: "runtime",
      surface: "cloudshare.v4.training.participant_list",
      failureMode: "unknown",
    },
    {
      label: "unclassified operation on an unfamiliar surface",
      operation: "cloudshare.future.operation",
      source: "future-runtime",
      surface: "cloudshare.v4.future_surface",
      failureMode: undefined,
    },
  ])("prioritizes authoritative HTTP 429 guidance for $label", ({ operation, source, surface, failureMode }) => {
    const hints = deriveDiagnosticSupportHints(makeEntry({
      operation,
      source,
      response: { status: 429 },
      details: {
        integrationSurface: surface,
        ...(failureMode ? { failureMode } : {}),
      },
    }));

    expect(hints).toEqual([expect.objectContaining({
      title: "CloudShare may have rate-limited the requester IP",
      body: "An error has occurred processing your request. It is possible that this request failed because the requester's IP address was placed on an abuse list and rate-limited. Please contact support@cloudshare.com for confirmation and assistance.",
    })]);
  });

  it("does not infer abuse-list rate limiting from an unrelated non-429 failure", () => {
    const hints = deriveDiagnosticSupportHints(makeEntry({
      operation: "exam_attempt.score.retrieve",
      response: { status: 502 },
      details: {
        integrationSurface: "cloudshare.v4.guided_journey.progress",
        failureMode: "unexpected_response",
      },
    }));

    expect(hints).toEqual([expect.objectContaining({
      title: "Guided Journey returned an unexpected payload",
    })]);
    expect(hints[0]?.body).not.toContain("abuse list");
  });

  it("does not label a local participant-mapping persistence failure as a CloudShare request failure", () => {
    const hints = deriveDiagnosticSupportHints(
      makeEntry({
        operation: "sales.demo_session.participants.reconciled",
        details: {
          integrationSurface: "cloudshare.v4.sales.participants",
          failureMode: "participant_mapping_persistence",
        },
        response: { status: 200, body: { count: 1 } },
      }),
    );

    expect(hints).toEqual([
      expect.objectContaining({ title: "Sales Participant monitoring could not be persisted" }),
    ]);
    expect(hints[0]?.title).not.toBe("CloudShare request failed");
  });

  it.each([
    ["environment_not_found_for_project", "zero"],
    ["environment_ambiguous_for_project", "multiple"],
  ] as const)("explains the completed v3 Environment lookup when %s matches %s Session Item Project Environments", (attentionReason, matchCount) => {
    const hints = deriveDiagnosticSupportHints(makeEntry({
      operation: "sales.demo_session.participant.environment_observed",
      message: "CloudShare returned no Environment for this participant in the Session Item project.",
      request: { method: "GET", path: "/api/v3/envs" },
      response: { status: 200, body: [] },
      details: {
        integrationSurface: "cloudshare.v3.environments",
        observation: "needs_attention",
        attentionReason,
        attentionSource: "cloudshare_v3_owner_email_item_project",
      },
    }));

    expect(hints).toEqual([expect.objectContaining({
      title: "CloudShare Environment correlation needs attention",
      body: expect.stringContaining("documented CloudShare v3 Environment list completed"),
    })]);
    expect(hints[0]?.body).toContain(`${matchCount} Environment`);
    expect(hints[0]?.body).toContain("Session Item Project");
    expect(hints[0]?.title).not.toBe("CloudShare request failed");
  });

  it.each([
    ["environment_not_found_for_project", "zero"],
    ["environment_ambiguous_for_project", "multiple"],
  ] as const)("explains the completed v4 Environment lookup when %s matches %s Session Item Project Environments", (attentionReason, matchCount) => {
    const hints = deriveDiagnosticSupportHints(makeEntry({
      operation: "sales.demo_session.participant.environment_observed",
      message: "CloudShare returned no Environment for this participant in the Session Item project.",
      request: { method: "GET", path: "/v4/environments" },
      response: { status: 200, body: [] },
      details: {
        integrationSurface: "cloudshare.v4.environments",
        observation: "needs_attention",
        attentionReason,
        attentionSource: "cloudshare_v4_owner_email_item_project",
      },
    }));

    expect(hints).toEqual([expect.objectContaining({
      title: "CloudShare Environment correlation needs attention",
      body: expect.stringContaining("documented CloudShare v4 Environment list completed"),
    })]);
    expect(hints[0]?.body).toContain(`${matchCount} Environment`);
    expect(hints[0]?.body).toContain("Session Item Project");
    expect(hints[0]?.title).not.toBe("CloudShare request failed");
  });

  it.each([
    {
      label: "a different correlation source",
      attentionSource: "cloudshare_v3_unscoped_lookup",
      response: { status: 200, body: [] },
    },
    {
      label: "a non-successful CloudShare response",
      attentionSource: "cloudshare_v3_owner_email_item_project",
      response: { status: 502, body: { error: "upstream failure" } },
    },
  ])("keeps generic request-failure guidance for an Environment observation with %s", ({ attentionSource, response }) => {
    const hints = deriveDiagnosticSupportHints(makeEntry({
      operation: "sales.demo_session.participant.environment_observed",
      request: { method: "GET", path: "/api/v3/envs" },
      response,
      details: {
        integrationSurface: "cloudshare.v3.environments",
        observation: "needs_attention",
        attentionReason: "environment_not_found_for_project",
        attentionSource,
      },
    }));

    expect(hints).toEqual([expect.objectContaining({
      title: "CloudShare request failed",
    })]);
  });

  it("describes a Sales reservation persistence failure as local and retryable", () => {
    const hints = deriveDiagnosticSupportHints(makeEntry({
      source: "sales-demo-sessions",
      operation: "sales.demo_session.created",
      details: { integrationSurface: "portal.sales_demo_sessions", failureMode: "local_reservation_persistence", cloudShareAttempted: false },
    }));

    expect(hints).toEqual([expect.objectContaining({
      title: "Sales Enablement Session reservation could not be saved",
      body: expect.stringContaining("No CloudShare operation was attempted"),
    })]);
    expect(hints[0]?.body).toContain("retry");
    expect(hints[0]?.body).toContain("Sales Enablement Session creation");
    expect(hints[0]?.title).not.toBe("CloudShare request failed");
  });

  it("describes a confirmed Sales Enablement Session revision collision as local", () => {
    const hints = deriveDiagnosticSupportHints(makeEntry({ operation: "sales.demo_session.created", details: { integrationSurface: "portal.sales_demo_sessions", failureMode: "revision_collision", cloudShareAttempted: false } }));
    expect(hints).toEqual([expect.objectContaining({ title: "Sales Enablement Session revision is already reserved", body: expect.stringContaining("No CloudShare operation was attempted") })]);
    expect(hints[0]?.body).toMatch(/refresh/i); expect(hints[0]?.body).toContain("retry"); expect(hints[0]?.title).not.toBe("CloudShare request failed");
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
