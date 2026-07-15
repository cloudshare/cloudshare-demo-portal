import type { PrismaClient } from "@prisma/client";
import type { SalesSessionOpportunityQuery } from "@/domain/sales-session-opportunity-query";

export function createPrismaSalesSessionOpportunityQuery(prisma: PrismaClient): SalesSessionOpportunityQuery {
  return { async list(customerId, query) {
    const search = query.search?.trim();
    const where = { customerId, archivedAt: null, ...(query.accountId ? { accountId: query.accountId } : {}), ...(search ? { OR: [{ name: { contains: search } }, { account: { name: { contains: search } } }] } : {}) };
    const [accounts, total, opportunities] = await Promise.all([
      prisma.salesAccount.findMany({ where: { customerId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.salesOpportunity.count({ where }),
      prisma.salesOpportunity.findMany({ where, select: { id: true, accountId: true, name: true, account: { select: { name: true } } }, orderBy: [{ account: { name: "asc" } }, { name: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return { accounts, opportunities: opportunities.map((opportunity) => ({ id: opportunity.id, accountId: opportunity.accountId, label: `${opportunity.account.name} - ${opportunity.name}` })), page: query.page, pageSize: query.pageSize, total };
  } };
}
