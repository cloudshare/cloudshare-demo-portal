import type { PrismaClient } from "@prisma/client";
import type { SalesDemoSession, SalesDemoSessionRepository } from "@/domain/sales-demo-session";

export function createPrismaSalesDemoSessionRepository(prisma: PrismaClient): SalesDemoSessionRepository {
  return {
    async save(session) { await prisma.salesDemoSession.create({ data: { ...session } }); },
    async list(customerId) { return (await prisma.salesDemoSession.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } })).map(toDomain); },
    async listByOpportunity(customerId, opportunityId) { return (await prisma.salesDemoSession.findMany({ where: { customerId, opportunityId }, orderBy: { createdAt: "desc" } })).map(toDomain); },
    async updateOperationalState(id, state) { await prisma.salesDemoSession.update({ where: { id }, data: state }); },
  };
}

function toDomain(row: { id: string; customerId: string; opportunityId: string; itemId: string; cloudShareSalesExperienceId: string; externalId: string; type: string; start: string; end: string; timeZone: string; salesProEmail: string; salesProDisplayName: string; registrationType: string; sendInvitations: string; sessionName: string; revision: number; operationalStatus: string; attentionReason: string | null; createdAt: Date }): SalesDemoSession {
  return { ...row, type: row.type as SalesDemoSession["type"], registrationType: "registeredParticipantsOnly", sendInvitations: "dontSend" };
}
