import { describe, expect, it, vi } from "vitest";
import { createSalesSessionRefresh } from "./sales-session-refresh";

describe("Sales Session refresh", () => {
  it("uses one bounded filtered page for automatic and manual refresh", async () => {
    const list = vi.fn().mockResolvedValue({ sessions: [{ id: "sales-1", status: "inProgress" }], total: 1 });
    const observe = vi.fn().mockResolvedValue(undefined);
    const refresh = createSalesSessionRefresh({ listSessions: list, sessions: { findById: vi.fn(), updateOperationalState: vi.fn() }, now: () => new Date("2026-09-08T10:00:00Z") });
    await expect(refresh.refreshQueue({ customerId: "customer-1", mode: "manual", offset: 0, limit: 25 })).resolves.toMatchObject({ rows: [{ id: "sales-1" }] });
    expect(list).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
  });

  it("verifies one session with the single Experience read", async () => {
    const readSession = vi.fn().mockResolvedValue({ id: "sales-1", status: "ended" });
    const updateOperationalState = vi.fn();
    const refresh = createSalesSessionRefresh({ listSessions: vi.fn(), readSession, sessions: { findById: vi.fn().mockResolvedValue({ id: "local-1", customerId: "customer-1", cloudShareSalesExperienceId: "sales-1", operationalStatus: "active" }), updateOperationalState }, now: () => new Date("2026-09-08T10:00:00Z") });
    await expect(refresh.verify({ customerId: "customer-1", sessionId: "local-1" })).resolves.toMatchObject({ observation: { status: "ended", freshness: "fresh" } });
    expect(readSession).toHaveBeenCalledWith("sales-1");
    expect(updateOperationalState).toHaveBeenCalledWith("customer-1", "local-1", expect.objectContaining({ experienceStatus: "ended" }));
  });
});
