import { describe, expect, it, vi } from "vitest";
import { SalesDemoSessionRevisionConflictError } from "@/domain/sales-demo-session";
import { createPrismaSalesDemoSessionRepository } from "./prisma-sales-demo-session-repository";

const session = { id: "session-1", customerId: "certalis", opportunityId: "opp-1", itemId: "item-1", cloudShareSalesExperienceId: "pending:session-1", externalId: "session1", type: "demo" as const, start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProEmail: "admin@certalis.demo", salesProDisplayName: "Admin", registrationType: "registeredParticipantsOnly" as const, sendInvitations: "salesProsAndParticipants" as const, revision: 1, operationalStatus: "provisioning" as const, createdAt: new Date() };

describe("Prisma Sales Enablement Session repository", () => {
  it("projects End only onto the Customer-owned Session and rejects a missing row", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { updateMany } } as never);
    await repository.updateEnd!("customer-a", "session-1", "2026-09-21T10:00");
    expect(updateMany).toHaveBeenCalledWith({ where: { customerId: "customer-a", id: "session-1" }, data: { end: "2026-09-21T10:00" } });
    await expect(repository.updateEnd!("customer-b", "session-1", "2026-09-21T10:00")).rejects.toThrow("Sales Enablement Session was not found for this Customer");
  });
  it("normalizes only the Customer + Opportunity + revision uniqueness violation", async () => {
    const create = vi.fn().mockRejectedValue({ code: "P2002", meta: { target: ["customerId", "opportunityId", "revision"] } });
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { create } } as never);
    await expect(repository.save(session)).rejects.toBeInstanceOf(SalesDemoSessionRevisionConflictError);
  });
  it("preserves other Prisma uniqueness violations and transient errors", async () => {
    const create = vi.fn().mockRejectedValueOnce({ code: "P2002", meta: { target: ["externalId"] } }).mockRejectedValueOnce(new Error("database transport unavailable"));
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { create } } as never);
    await expect(repository.save(session)).rejects.toMatchObject({ code: "P2002" });
    await expect(repository.save(session)).rejects.toThrow("database transport unavailable");
  });
  it("scopes Experience-status observation writes to the authenticated Customer", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { updateMany } } as never);
    await repository.updateOperationalState!("customer-a", "session-1", { operationalStatus: "active", experienceStatus: "inProgress", experienceStatusObservedAt: new Date("2026-07-19T18:00:00Z") });
    expect(updateMany).toHaveBeenCalledWith({ where: { customerId: "customer-a", id: "session-1" }, data: expect.objectContaining({ experienceStatus: "inProgress" }) });
  });
  it("fails closed when a Customer-scoped Experience-status observation no longer has a row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { updateMany } } as never);
    await expect(repository.updateOperationalState!("customer-a", "session-1", { operationalStatus: "active" })).rejects.toThrow("Sales Enablement Session was not found for this Customer");
  });
  it("uses one transaction and rolls back all observations when a later row fails", async () => {
    const rows = new Map([["session-1", "notStarted"], ["session-2", "notStarted"]]);
    const updateMany = vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: { experienceStatus: string } }) => { if (where.id === "session-2") throw new Error("mid-batch failure"); rows.set(where.id, data.experienceStatus); return { count: 1 }; });
    const transaction = vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => { const before = new Map(rows); try { await callback({ salesDemoSession: { updateMany } }); } catch (error) { rows.clear(); for (const [key, value] of before) rows.set(key, value); throw error; } });
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { updateMany }, $transaction: transaction } as never);
    await expect(repository.recordExperienceObservations!("customer-a", [{ id: "session-1", experienceStatus: "inProgress", experienceStatusObservedAt: new Date() }, { id: "session-2", experienceStatus: "ended", experienceStatusObservedAt: new Date() }])).rejects.toThrow("mid-batch failure");
    expect([...rows.values()]).toEqual(["notStarted", "notStarted"]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("does not replace an equal-timestamp observation, making ties deterministic", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 }); const count = vi.fn().mockResolvedValue(1);
    const repository = createPrismaSalesDemoSessionRepository({ salesDemoSession: { updateMany, count }, $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({ salesDemoSession: { updateMany, count } }) } as never);
    const at = new Date("2026-07-19T18:00:00Z"); await repository.recordExperienceObservations!("customer-a", [{ id: "session-1", experienceStatus: "ended", experienceStatusObservedAt: at }]);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ experienceStatusObservedAt: null }, { experienceStatusObservedAt: { lt: at } }] }) }));
  });
});
