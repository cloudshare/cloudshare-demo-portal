import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionQueueRepository } from "./prisma-sales-session-queue-repository";

describe("Prisma Sales Session queue repository", () => {
  it("keeps Customer, Account, attention EXISTS, bounded page, and stable order in one query", async () => {
    const count = vi.fn().mockResolvedValue(0); const findMany = vi.fn().mockResolvedValue([]);
    const repository = createPrismaSalesSessionQueueRepository({ salesDemoSession: { count, findMany } } as never);
    await repository.read({ customerId: "customer-a", view: "needs_attention", accountId: "account-a", search: "acme", sort: "start_desc", offset: 25, limit: 25 });
    const filters = count.mock.calls[0][0].where.AND;
    expect(filters).toContainEqual({ customerId: "customer-a" });
    expect(filters).toContainEqual({ opportunity: { accountId: "account-a" } });
    expect(filters).toContainEqual({ OR: [{ operationalStatus: "needs_attention" }, { participants: { some: { environmentAttentionReason: { not: null } } } }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25, orderBy: [{ start: "desc" }, { id: "asc" }] }));
  });

  it("fails restoration closed for another Customer by querying target with the active Customer", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = createPrismaSalesSessionQueueRepository({ salesDemoSession: { findFirst } } as never);
    await expect(repository.findTarget("customer-a", "session-b")).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "customer-a", id: "session-b" } }));
  });
});
