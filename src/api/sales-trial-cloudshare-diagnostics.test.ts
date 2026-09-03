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
});
