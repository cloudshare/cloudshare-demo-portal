import { describe, expect, it, vi } from "vitest";
import { createPrismaSalesSessionQueueRepository } from "./prisma-sales-session-queue-repository";

describe("Prisma Sales Session queue repository", () => {
  it("keeps Customer, Account, attention EXISTS, bounded page, and stable order in one query", async () => {
    const count = vi.fn().mockResolvedValue(0); const findMany = vi.fn().mockResolvedValue([]);
    const repository = createPrismaSalesSessionQueueRepository({ salesDemoSession: { count, findMany } } as never);
    await repository.read({ customerId: "customer-a", view: "needs_attention", accountId: "account-a", search: "acme", sort: "start_desc", offset: 25, limit: 25, now: new Date("2026-07-23T10:00:00Z") });
    const filters = count.mock.calls[0][0].where.AND;
    expect(filters).toContainEqual({ customerId: "customer-a" });
    expect(filters).toContainEqual({ opportunity: { accountId: "account-a" } });
    expect(filters).toContainEqual({ OR: [{ operationalStatus: "needs_attention" }, { participants: { some: { environmentAttentionReason: { not: null } } } }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 25, take: 25, orderBy: [{ start: "desc" }, { id: "asc" }] }));
  });

  it("projects the latest persisted participant observation for routine queue rows", async () => {
    const observedAt = new Date("2026-07-23T09:00:00Z");
    const findMany = vi.fn().mockResolvedValue([{ id: "session-1", customerId: "customer-a", opportunityId: "opportunity-a", itemId: "item-a", cloudShareSalesExperienceId: "sales-1", externalId: "external-1", type: "demo", start: "2026-07-24T09:00", end: "2026-07-24T10:00", timeZone: "UTC", salesProEmail: "sales@example.test", salesProDisplayName: "Sales", sendInvitations: "dontSend", sessionName: "Acme", revision: 1, operationalStatus: "active", attentionReason: null, experienceStatus: "notStarted", experienceStatusObservedAt: null, createdAt: observedAt, opportunity: { accountId: "account-a", name: "Evaluation", account: { name: "Acme" } }, participants: [{ environmentStatus: "Ready", environmentStatusCode: null, environmentObservedAt: observedAt, environmentAttentionReason: null, contact: { firstName: "Ada", lastName: "Lovelace" } }] }]);
    const repository = createPrismaSalesSessionQueueRepository({ salesDemoSession: { findMany } } as never);

    const page = await repository.read({ customerId: "customer-a", view: "active", sort: "start_desc", offset: 0, limit: 25, now: new Date("2026-07-23T10:00:00Z") });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ participants: expect.objectContaining({ orderBy: [{ environmentObservedAt: "desc" }, { id: "asc" }], take: 1 }) }) }));
    expect(page.rows[0]?.participantEnvironment?.observation).toMatchObject({ value: "Ready", source: "cloudshare_v4_sales_participant_roster" });
  });

  it("fails restoration closed for another Customer by querying target with the active Customer", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = createPrismaSalesSessionQueueRepository({ salesDemoSession: { findFirst } } as never);
    await expect(repository.findTarget("customer-a", "session-b")).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "customer-a", id: "session-b" } }));
  });
});
