import { describe, expect, it } from "vitest";
import { buildOperationalSalesSessions } from "./sales-session-operations";

const base = { customerId: "certalis", opportunityId: "opp", itemId: "item", externalId: "opaque", type: "demo" as const, timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Sales Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, createdAt: new Date("2026-07-15T00:00:00Z") };

describe("Sales Session operations read model", () => {
  it("keeps persisted history visible without an Opportunity selection and partitions lifecycle views", () => {
    const rows = buildOperationalSalesSessions([
      { ...base, id: "past", cloudShareSalesExperienceId: "sales-past", start: "2026-07-14T08:00", end: "2026-07-14T09:00" },
      { ...base, id: "live", cloudShareSalesExperienceId: "sales-live", start: "2026-07-15T08:00", end: "2026-07-15T10:00" },
      { ...base, id: "future", cloudShareSalesExperienceId: "sales-future", start: "2026-07-16T08:00", end: "2026-07-16T10:00" },
      { ...base, id: "reconcile", cloudShareSalesExperienceId: "unprovisioned", start: "2026-07-15T08:00", end: "2026-07-15T10:00" },
    ], new Date("2026-07-15T09:00:00Z"));

    expect(rows.map((row) => row.lifecycle)).toEqual(["ended", "in_progress", "upcoming", "provisioning"]);
    expect(buildOperationalSalesSessions([{ ...base, id: "live", cloudShareSalesExperienceId: "sales-live", start: "2026-07-15T08:00", end: "2026-07-15T10:00" }], new Date("2026-07-15T09:00:00Z"), "in_progress")).toHaveLength(1);
    expect(buildOperationalSalesSessions([{ ...base, id: "reconcile", cloudShareSalesExperienceId: "unprovisioned", start: "2026-07-15T08:00", end: "2026-07-15T10:00" }], new Date("2026-07-15T09:00:00Z"), "needs_attention")).toHaveLength(1);
  });
});
