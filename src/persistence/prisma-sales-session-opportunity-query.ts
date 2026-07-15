import type { PrismaClient } from "@prisma/client";
import type { SalesSessionOpportunityQuery } from "@/domain/sales-session-opportunity-query";

export function createPrismaSalesSessionOpportunityQuery(prisma: PrismaClient): SalesSessionOpportunityQuery {
  return { async list(customerId, query) {
    const search = query.search?.trim(); const accountSearch = query.accountSearch?.trim();
    const where = { customerId, archivedAt: null, ...(query.accountId ? { accountId: query.accountId } : {}), ...(query.selectedOpportunityId ? { id: query.selectedOpportunityId } : {}), ...(search ? { OR: [{ name: { contains: search } }, { account: { name: { contains: search } } }] } : {}) };
    const accountWhere = { customerId, archivedAt: null, ...(query.accountId ? { id: query.accountId } : {}), ...(accountSearch ? { name: { contains: accountSearch } } : {}) };
    const [accounts, accountTotal, total, opportunities, highestRevision] = await Promise.all([
      prisma.salesAccount.findMany({ where: accountWhere, select: { id: true, name: true }, orderBy: { name: "asc" }, skip: (query.accountPage - 1) * query.accountPageSize, take: query.accountPageSize }),
      prisma.salesAccount.count({ where: accountWhere }),
      prisma.salesOpportunity.count({ where }),
      prisma.salesOpportunity.findMany({ where, select: { id: true, accountId: true, name: true, account: { select: { name: true } } }, orderBy: [{ account: { name: "asc" } }, { name: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      query.selectedOpportunityId ? prisma.salesDemoSession.aggregate({ where: { customerId, opportunityId: query.selectedOpportunityId }, _max: { revision: true } }) : Promise.resolve(null),
    ]);
    return { accounts, accountPage: query.accountPage, accountPageSize: query.accountPageSize, accountTotal, opportunities: opportunities.map((opportunity) => ({ id: opportunity.id, accountId: opportunity.accountId, label: `${opportunity.account.name} - ${opportunity.name}` })), page: query.page, pageSize: query.pageSize, total, ...(highestRevision ? { nextRevision: (highestRevision._max.revision ?? 0) + 1 } : {}) };
  } };
}
