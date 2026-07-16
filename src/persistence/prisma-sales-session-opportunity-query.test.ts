import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaSalesSessionOpportunityQuery } from "./prisma-sales-session-opportunity-query";

describe("Prisma Sales Session Opportunity query", () => {
  it("offers only active Opportunities under active Accounts for provisioning", async () => {
    const opportunityFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      salesAccount: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      salesOpportunity: { findMany: opportunityFindMany, count: vi.fn().mockResolvedValue(0) },
      salesDemoSession: { aggregate: vi.fn() },
    } as unknown as PrismaClient;

    await createPrismaSalesSessionOpportunityQuery(prisma).list("customer-1", { accountPage: 1, accountPageSize: 50, page: 1, pageSize: 50 });

    expect(opportunityFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: "customer-1", archivedAt: null, account: { archivedAt: null } }) }));
  });
});
