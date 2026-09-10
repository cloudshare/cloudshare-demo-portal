import { describe, expect, it, vi } from "vitest";
import { handleRefreshSalesSessions } from "./sales-session-refresh";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const makeSession = (id: string, customerId: string, providerId: string) => ({ id, customerId, opportunityId: "opp", itemId: "item", cloudShareSalesExperienceId: providerId, externalId: id, type: "demo" as const, start: "2026-07-01T09:00", end: "2026-07-01T10:00", timeZone: "UTC", salesProEmail: "admin@example.test", salesProDisplayName: "Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, createdAt: new Date() });

describe("Sales Session refresh route composition", () => {
  it("production route derives Customer from authenticated session and forwards query targets", () => {
    const source = readFileSync(fileURLToPath(new URL("../../app/api/sales/enablement-sessions/refresh/route.ts", import.meta.url)), "utf8");
    expect(source).toContain("session.customerId"); expect(source).toContain("query.getAll(\"targetId\")"); expect(source).toContain("query.get(\"mode\")"); expect(source).not.toContain("customerId: query.get");
  });
  it.each(["active", "needs_attention", "history"]) ("uses the derived Customer and exact target IDs for %s page two", async (view) => {
    const listForRefresh = vi.fn().mockResolvedValue([makeSession("page-2", "customer-derived", "provider-2")]);
    const listSessions = vi.fn().mockResolvedValue({ sessions: [{ id: "provider-2", status: "inProgress" }], total: 1 });
    const result = await handleRefreshSalesSessions({ sessions: { list: vi.fn(), listForRefresh, recordExperienceObservations: vi.fn() }, delivery: { listSessions } }, { customerId: "customer-derived", mode: view === "history" ? "manual" : "automatic", offset: 25, limit: 25, targetIds: ["page-2"] });
    expect(result.status).toBe(200);
    expect(listForRefresh).toHaveBeenCalledWith("customer-derived", { targetIds: ["page-2"], limit: 25 });
    expect(listSessions).toHaveBeenCalledTimes(1);
  });
  it("does not read CloudShare for unknown or other-Customer targets and never leaks a sentinel", async () => {
    const provider = vi.fn();
    const result = await handleRefreshSalesSessions({ sessions: { list: vi.fn(), listForRefresh: vi.fn().mockResolvedValue([]), recordExperienceObservations: vi.fn() }, delivery: { listSessions: provider } }, { customerId: "customer-a", mode: "manual", offset: 25, limit: 25, targetIds: ["unknown", "other-customer-row"] });
    expect(result.status).toBe(200);
    expect(provider).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain("SENTINEL_PROTECTED_BODY");
  });
});
