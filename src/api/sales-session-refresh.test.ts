import { describe, expect, it, vi } from "vitest";
import { handleRefreshSalesSessions } from "./sales-session-refresh";

const session = (id: string, experience: string, observedAt?: Date) => ({ id, customerId: "customer-1", opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: experience, externalId: id, type: "demo" as const, start: "2026-09-08T09:00", end: "2026-09-08T10:00", timeZone: "UTC", salesProEmail: "owner@example.test", salesProDisplayName: "Owner", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "dontSend" as const, createdAt: new Date("2026-09-08T08:00Z"), experienceStatusObservedAt: observedAt });

describe("Sales Session refresh handler", () => {
  it("refreshes only the exact rendered target ids and isolates Customers", async () => {
    const record = vi.fn();
    const listSessions = vi.fn().mockResolvedValue({ sessions: [{ id: "sales-1", status: "inProgress" }], total: 1 });
    const result = await handleRefreshSalesSessions({ sessions: { list: vi.fn().mockResolvedValue([session("local-1", "sales-1"), session("local-other", "sales-other")]), recordExperienceObservation: record }, delivery: { listSessions, readSession: vi.fn() }, diagnostics: { record } }, { customerId: "customer-1", mode: "manual", offset: 0, limit: 25, targetIds: ["local-1"] });
    expect(result.status).toBe(200);
    expect(record).toHaveBeenCalledWith("customer-1", "local-1", expect.objectContaining({ experienceStatus: "inProgress" }));
    expect(record).not.toHaveBeenCalledWith("customer-1", "local-other", expect.anything());
    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ field: '"sales-1"' }));
  });

  it("fails closed on duplicate provider rows without persisting either row", async () => {
    const persist = vi.fn();
    const result = await handleRefreshSalesSessions({ sessions: { list: vi.fn().mockResolvedValue([session("local-1", "sales-1")]), recordExperienceObservation: persist }, delivery: { listSessions: vi.fn().mockResolvedValue({ sessions: [{ id: "sales-1", status: "inProgress" }, { id: "sales-1", status: "ended" }], total: 2 }) } }, { customerId: "customer-1", mode: "manual", offset: 0, limit: 25 });
    expect(result.status).toBe(502);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects unbounded pagination before contacting CloudShare", async () => {
    const list = vi.fn();
    const result = await handleRefreshSalesSessions({ sessions: { list: vi.fn(), recordExperienceObservation: vi.fn() }, delivery: { listSessions: list, readSession: vi.fn() } }, { customerId: "customer-1", mode: "manual", offset: 0, limit: 101 });
    expect(result.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});
