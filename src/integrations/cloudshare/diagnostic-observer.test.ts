import { describe, expect, it, vi } from "vitest";
import { createCloudShareDiagnosticObserver } from "./diagnostic-observer";
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
