import { describe, expect, it, vi } from "vitest";
import { createSalesTrialCloudShareObserver } from "./sales-trial-cloudshare-diagnostics";

describe("createSalesTrialCloudShareObserver", () => {
  it.each([
    ["transport_failure", "dns"],
    ["http_failure", undefined],
    ["unexpected_response", "invalid_schema"],
  ] as const)("persists a metadata-only %s OAuth acquisition row", async (failureMode, causeClassification) => {
    const record = vi.fn();
    const observer = createSalesTrialCloudShareObserver({
      diagnostics: { record } as never,
      customerId: "customer-1",
      actor: { type: "admin", id: "admin-1" },
      subject: { type: "sales_trial_offering", id: "offering-1" },
      correlationId: "correlation-1",
      source: "sales-trial-offerings",
    });

    await observer.onAcquisition({
      occurredAt: "2026-09-03T12:00:00.000Z", outcome: "failure", durationMs: 2,
      status: 200, integrationSurface: "cloudshare.v4.oauth.token", failureMode, causeClassification,
    });

    const [entry] = record.mock.calls[0] ?? [];
    expect(entry).toEqual(expect.objectContaining({
      customerId: "customer-1", correlationId: "correlation-1",
      details: expect.objectContaining({ failureMode, ...(causeClassification ? { causeClassification } : {}) }),
    }));
    expect(entry).not.toHaveProperty("request");
    expect(entry).not.toHaveProperty("response");
    expect(JSON.stringify(record.mock.calls)).not.toContain("client_secret");
    expect(JSON.stringify(record.mock.calls)).not.toContain("access_token");
  });

  it("D: persists Trial transport request and OAuth timing identity with evidenceKind", async () => {
    const record = vi.fn();
    const observer = createSalesTrialCloudShareObserver({ diagnostics: { record } as never, customerId: "customer-1", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_trial_offering", id: "offering-1" }, correlationId: "corr-d", source: "sales-trial-offerings" });
    await observer.onRequest({ exchangeId: "exchange-request", attemptStartSequence: 4, occurredAt: "2026-09-03T12:00:00.000Z", completedAt: "2026-09-03T12:00:00.250Z", durationMs: 250, outcome: "success", result: { request: { method: "GET", path: "/v4/sales" }, response: { status: 200 }, integrationSurface: "cloudshare.v4.sales", host: "example.test" } } as never);
    await observer.onAcquisition({ exchangeCorrelationId: "exchange-oauth", attemptStartSequence: 3, occurredAt: "2026-09-03T12:00:01.000Z", completedAt: "2026-09-03T12:00:01.100Z", durationMs: 100, outcome: "success", status: 200, integrationSurface: "cloudshare.v4.oauth.token" });
    expect(record.mock.calls[0][0]).toMatchObject({ details: { exchangeId: "exchange-request", attemptStartSequence: 4, completedAt: "2026-09-03T12:00:00.250Z", durationMs: 250, evidenceKind: "transport" } });
    expect(record.mock.calls[1][0]).toMatchObject({ request: null, response: null, details: { exchangeId: "exchange-oauth", attemptStartSequence: 3, completedAt: "2026-09-03T12:00:01.100Z", durationMs: 100, evidenceKind: "transport" } });
  });
});
