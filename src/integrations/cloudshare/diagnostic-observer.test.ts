import { describe, expect, it, vi } from "vitest";
import { createCloudShareDiagnosticObserver, createCloudShareWorkflowObserver } from "./diagnostic-observer";
import { CloudShareAuthError } from "./errors";

function makeObserver() {
  const record = vi.fn();
  return { record, observer: createCloudShareDiagnosticObserver({ diagnostics: { record } as never, customerId: "customer-1" }) };
}

describe("createCloudShareDiagnosticObserver", () => {
  it("normalizes responseStatus-only and status-only failure contexts", () => {
    const { record, observer } = makeObserver();
    observer.onRequest({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "failure", durationMs: 1,
      error: { name: "CloudShareResponseError", message: "failed", context: { responseStatus: 503 } },
    } as never);
    observer.onRequest({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "failure", durationMs: 1,
      error: { name: "CloudShareResponseError", message: "failed", context: { status: 504 } },
    } as never);
    expect(record.mock.calls[0][0].response).toEqual({ status: 503 });
    expect(record.mock.calls[1][0].response).toEqual({ status: 504 });
  });

  it("keeps mandatory Customer capture filterable and ordered when no narrower workflow applies", () => {
    const record = vi.fn();
    const observer = createCloudShareDiagnosticObserver({ diagnostics: { record } as never, customerId: "customer-1", correlationId: "customer-thread" });
    observer.onAcquisition({ occurredAt: "2026-09-03T12:00:00.000Z", outcome: "success", durationMs: 1, integrationSurface: "cloudshare.v4.oauth.token" });
    observer.onRequest({ occurredAt: "2026-09-03T12:00:01.000Z", outcome: "success", durationMs: 1, result: { request: {}, response: {}, integrationSurface: "cloudshare.v4.projects", host: "example.test" } } as never);
    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({ subject: { type: "customer", id: "customer-1" }, correlationId: "customer-thread", details: expect.objectContaining({ sequence: 1 }) }),
      expect.objectContaining({ subject: { type: "customer", id: "customer-1" }, correlationId: "customer-thread", details: expect.objectContaining({ sequence: 2 }) }),
    ]);
  });

  it("records OAuth failure metadata without credentials or raw causes", () => {
    const { record, observer } = makeObserver();
    observer.onAcquisition({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "failure", durationMs: 2,
      status: 503, integrationSurface: "cloudshare.v4.oauth.token",
      failureMode: "transport_failure", causeClassification: "dns",
    });
    expect(record.mock.calls[0][0].details).toEqual(expect.objectContaining({ failureMode: "transport_failure", causeClassification: "dns" }));
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain("client_secret");
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain("raw");
  });

  it("keeps default request-observer OAuth failures metadata-only", () => {
    const { record, observer } = makeObserver();
    observer.onRequest({
      occurredAt: "2026-09-03T12:00:00.000Z",
      outcome: "failure",
      durationMs: 3,
      error: new CloudShareAuthError("OAuth token exchange returned 503", {
        method: "POST",
        path: "/oauth/token",
        integrationSurface: "cloudshare.v4.oauth.token",
        failureMode: "cloudshare_oauth_token",
        status: 503,
        requestBody: { client_id: "private-client", client_secret: "private-secret" },
        responseBody: { access_token: "private-token" },
      }),
    });

    expect(record.mock.calls[0][0]).toMatchObject({
      request: null,
      response: null,
      details: {
        durationMs: 3,
        integrationSurface: "cloudshare.v4.oauth.token",
        failureMode: "cloudshare_oauth_token",
        error: {
          name: "CloudShareAuthError",
          message: "OAuth token exchange returned 503",
          status: 503,
        },
      },
    });
    expect(record.mock.calls[0][0].details.error).not.toHaveProperty("context");
    const persisted = JSON.stringify(record.mock.calls[0][0]);
    expect(persisted).not.toContain("private-client");
    expect(persisted).not.toContain("private-secret");
    expect(persisted).not.toContain("private-token");
  });
});

describe("createCloudShareWorkflowObserver", () => {
  it("keeps OAuth metadata-only while anchoring it and later requests to one exact workflow sequence", async () => {
    const record = vi.fn();
    const observer = createCloudShareWorkflowObserver({
      diagnostics: { record } as never,
      customerId: "helios",
      actor: { type: "candidate", id: "candidate-1", email: "candidate@example.test" },
      subject: { type: "exam_attempt", id: "attempt-1" },
      correlationId: "correlation-1",
      source: "candidate-portal",
      examId: "exam-1",
      examAttemptId: "attempt-1",
      candidateEmail: "candidate@example.test",
    });

    await observer.onAcquisition({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "success", durationMs: 2,
      integrationSurface: "cloudshare.v4.oauth.token",
    });
    await observer.onRequest({
      occurredAt: "2026-09-03T12:00:01.000Z", outcome: "success", durationMs: 3,
      result: { integrationSurface: "cloudshare.v4.training", host: "api.example.test", request: { method: "POST" }, response: { status: 201 } },
    } as never);

    expect(record.mock.calls.map(([entry]) => entry)).toEqual([
      expect.objectContaining({
        operation: "cloudshare.oauth.token", customerId: "helios", subject: { type: "exam_attempt", id: "attempt-1" },
        correlationId: "correlation-1", examId: "exam-1", examAttemptId: "attempt-1", candidateEmail: "candidate@example.test",
        request: null, response: null, details: expect.objectContaining({ sequence: 1, integrationSurface: "cloudshare.v4.oauth.token" }),
      }),
      expect.objectContaining({
        operation: "cloudshare.request", customerId: "helios", subject: { type: "exam_attempt", id: "attempt-1" },
        correlationId: "correlation-1", examId: "exam-1", examAttemptId: "attempt-1", candidateEmail: "candidate@example.test",
        details: expect.objectContaining({ sequence: 2 }),
      }),
    ]);
  });

  it("keeps Customer-scoped workflow rows isolated even when correlations match", async () => {
    const helios = vi.fn();
    const certalis = vi.fn();
    const shared = {
      actor: { type: "system", id: "test" }, subject: { type: "exam", id: "exam-1" },
      correlationId: "same-correlation", source: "candidate-portal",
    } as const;
    await createCloudShareWorkflowObserver({ diagnostics: { record: helios } as never, customerId: "helios", ...shared }).onAcquisition({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "success", durationMs: 1, integrationSurface: "cloudshare.v4.oauth.token",
    });
    await createCloudShareWorkflowObserver({ diagnostics: { record: certalis } as never, customerId: "certalis", ...shared }).onAcquisition({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "success", durationMs: 1, integrationSurface: "cloudshare.v4.oauth.token",
    });
    expect(helios).toHaveBeenCalledWith(expect.objectContaining({ customerId: "helios", correlationId: "same-correlation" }));
    expect(certalis).toHaveBeenCalledWith(expect.objectContaining({ customerId: "certalis", correlationId: "same-correlation" }));
  });
});
