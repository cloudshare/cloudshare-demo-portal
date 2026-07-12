import type { PrismaClient } from "@prisma/client";
import type { OpportunityContact, SalesAccount, SalesOpportunity, SalesRecordRepository } from "@/domain/sales-records";

export function createPrismaSalesRecordRepository(prisma: PrismaClient): SalesRecordRepository {
  return {
    async listAccounts(customerId, search) {
      return prisma.salesAccount.findMany({
        where: { customerId, ...(search ? { name: { contains: search } } : {}) },
        orderBy: { updatedAt: "desc" },
      });
    },
    async findAccount(customerId, id) { return prisma.salesAccount.findFirst({ where: { id, customerId } }); },
    async saveAccount(account) { await prisma.salesAccount.upsert({ where: { id: account.id }, update: account, create: account }); },
    async listOpportunities(customerId, search) {
      return prisma.salesOpportunity.findMany({
        where: { customerId, ...(search ? { name: { contains: search } } : {}) },
        orderBy: { updatedAt: "desc" },
      });
    },
    async findOpportunity(customerId, id) { return prisma.salesOpportunity.findFirst({ where: { id, customerId } }); },
    async saveOpportunity(opportunity) { await prisma.salesOpportunity.upsert({ where: { id: opportunity.id }, update: opportunity, create: opportunity }); },
    async listContacts(customerId, opportunityId) {
      return prisma.opportunityContact.findMany({ where: { customerId, ...(opportunityId ? { opportunityId } : {}) }, orderBy: { updatedAt: "desc" } });
    },
    async findContact(customerId, id) { return prisma.opportunityContact.findFirst({ where: { id, customerId } }); },
    async saveContact(contact) { await prisma.opportunityContact.upsert({ where: { id: contact.id }, update: contact, create: contact }); },
  } as SalesRecordRepository;
}
