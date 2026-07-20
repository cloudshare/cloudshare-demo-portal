import { describe, expect, it } from "vitest";
import { projectSalesSessionStatus } from "./sales-session-status";

describe("Sales Session status projection", () => {
  it("keeps Certalis operation state structurally distinct from Experience status", () => {
    const status = projectSalesSessionStatus({ operationalStatus: "needs_attention", attentionReason: "Correlation persistence failed", start: "2026-07-20T09:00", end: "2026-07-20T10:00", timeZone: "UTC" }, new Date("2026-07-19T09:00:00Z"));

    expect(status.operation).toEqual({ dimension: "certalis_operation", value: "needs_attention", source: "certalis_persistence", reason: "Correlation persistence failed", retry: "unsafe_requires_support" });
    expect(status.experience).toEqual({ dimension: "cloudshare_sales_experience", value: "notStarted", source: "schedule_prediction", freshness: "predicted" });
  });

  it("uses a fresh documented provider Experience status without changing the operation dimension", () => {
    const status = projectSalesSessionStatus({ operationalStatus: "active", start: "2026-07-20T09:00", end: "2026-07-20T10:00", timeZone: "UTC", experienceStatus: "inProgress", experienceStatusObservedAt: new Date("2026-07-19T09:01:00Z") }, new Date("2026-07-19T09:00:00Z"));

    expect(status.operation).toEqual({ dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" });
    expect(status.experience).toEqual({ dimension: "cloudshare_sales_experience", value: "inProgress", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-07-19T09:01:00.000Z" });
  });

  it("labels an expired provider observation as a schedule prediction", () => {
    const status = projectSalesSessionStatus({ operationalStatus: "active", start: "2026-07-20T09:00", end: "2026-07-20T10:00", timeZone: "UTC", experienceStatus: "ended", experienceStatusObservedAt: new Date("2026-07-19T08:00:00Z") }, new Date("2026-07-19T09:00:00Z"));

    expect(status.experience).toEqual({ dimension: "cloudshare_sales_experience", value: "notStarted", source: "schedule_prediction", freshness: "predicted" });
  });
});
