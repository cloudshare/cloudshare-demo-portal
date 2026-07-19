import { describe, expect, it } from "vitest";
import { buildOperationalSalesSessions } from "./sales-session-operations";
import type { SalesDemoSession } from "./sales-demo-session";

const base = { customerId: "certalis", opportunityId: "opp", itemId: "item", externalId: "opaque", type: "demo" as const, timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, operationalStatus: "active" as const, createdAt: new Date("2026-07-15T00:00:00Z") };

describe("Sales Session operations read model", () => {
  it("keeps persisted history visible without flattening operation and Experience dimensions", () => {
    const rows = buildOperationalSalesSessions([
      { ...base, id: "past", cloudShareSalesExperienceId: "sales-past", start: "2026-07-14T08:00", end: "2026-07-14T09:00" },
      { ...base, id: "live", cloudShareSalesExperienceId: "sales-live", start: "2026-07-15T08:00", end: "2026-07-15T10:00" },
      { ...base, id: "future", cloudShareSalesExperienceId: "sales-future", start: "2026-07-16T08:00", end: "2026-07-16T10:00" },
      { ...base, id: "reconcile", cloudShareSalesExperienceId: "unprovisioned", start: "2026-07-15T08:00", end: "2026-07-15T10:00" },
    ], new Date("2026-07-15T09:00:00Z"));

    expect(rows.map((row) => row.experience.value)).toEqual(["ended", "inProgress", "notStarted", "inProgress"]);
    expect(rows.map((row) => row.operation.value)).toEqual(["correlated", "correlated", "correlated", "provisioning"]);
    expect(rows.every((row) => !("lifecycle" in row))).toBe(true);
    expect(rows.map((row) => row.verificationEligible)).toEqual([true, true, true, false]);
    expect(buildOperationalSalesSessions([{ ...base, id: "live", cloudShareSalesExperienceId: "sales-live", start: "2026-07-15T08:00", end: "2026-07-15T10:00" }], new Date("2026-07-15T09:00:00Z"), { experience: "inProgress" })).toHaveLength(1);
    expect(buildOperationalSalesSessions([{ ...base, id: "reconcile", cloudShareSalesExperienceId: "unprovisioned", start: "2026-07-15T08:00", end: "2026-07-15T10:00" }], new Date("2026-07-15T09:00:00Z"), { operation: "needs_attention" })).toHaveLength(0);
  });

  it("makes needs-attention exclusive of provisioning and tolerates a Windows timezone ID", () => {
    const sessions: SalesDemoSession[] = [
      { ...base, id: "attention", cloudShareSalesExperienceId: "sales-1", operationalStatus: "needs_attention", start: "2026-07-15T08:00", end: "2026-07-15T10:00" },
      { ...base, id: "pending", cloudShareSalesExperienceId: "pending:1", operationalStatus: "provisioning", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "Pacific Standard Time" },
    ];
    const rows = buildOperationalSalesSessions(sessions, new Date("2026-07-15T09:00:00Z"));

    expect(rows.map((row) => row.operation.value)).toEqual(["needs_attention", "provisioning"]);
    expect(rows.map((row) => row.experience.dimension)).toEqual(["cloudshare_sales_experience", "cloudshare_sales_experience"]);
    expect(buildOperationalSalesSessions(sessions, new Date("2026-07-15T09:00:00Z"), { operation: "provisioning" })).not.toContainEqual(expect.objectContaining({ id: "attention" }));
  });

  it("filters operation and Experience dimensions independently", () => {
    const attention = { ...base, id: "attention", cloudShareSalesExperienceId: "sales-1", operationalStatus: "needs_attention" as const, start: "2026-07-16T08:00", end: "2026-07-16T10:00" };
    const now = new Date("2026-07-15T09:00:00Z");

    expect(buildOperationalSalesSessions([attention], now, { operation: "needs_attention" })).toHaveLength(1);
    expect(buildOperationalSalesSessions([attention], now, { experience: "notStarted" })).toHaveLength(1);
    expect(buildOperationalSalesSessions([attention], now, { operation: "needs_attention", experience: "inProgress" })).toHaveLength(0);
  });

  it("derives only the schedule-predicted Experience dimension through the shared Windows wall-clock resolver", () => {
    const rows = buildOperationalSalesSessions([{ ...base, id: "central-america", cloudShareSalesExperienceId: "sales-1", timeZone: "Central America Standard Time", start: "2026-07-15T08:00", end: "2026-07-15T10:00" }], new Date("2026-07-15T14:00:00Z"));
    expect(rows[0]?.experience).toMatchObject({ dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction" });
    expect(rows[0]?.operation).toMatchObject({ dimension: "certalis_operation", value: "correlated" });
  });
});
