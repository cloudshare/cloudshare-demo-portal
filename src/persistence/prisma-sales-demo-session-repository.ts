import type { PrismaClient } from "@prisma/client";
import { SalesDemoSessionRevisionConflictError, type SalesDemoSession, type SalesDemoSessionRepository } from "@/domain/sales-demo-session";

export function createPrismaSalesDemoSessionRepository(prisma: PrismaClient): SalesDemoSessionRepository {
  return {
    async save(session) {
      try { await prisma.salesDemoSession.create({ data: { ...session } }); }
      catch (error) {
        if (isSalesSessionRevisionConflict(error)) throw new SalesDemoSessionRevisionConflictError();
        throw error;
      }
    },
    async list(customerId) { return (await prisma.salesDemoSession.findMany({ where: { customerId }, orderBy: { createdAt: "desc" } })).map(toDomain); },
    async listByAccount(customerId, accountId) { return (await prisma.salesDemoSession.findMany({ where: { customerId, opportunity: { accountId } }, orderBy: { createdAt: "desc" } })).map(toDomain); },
    async findById(customerId, id) { const row = await prisma.salesDemoSession.findFirst({ where: { customerId, id } }); return row ? toDomain(row) : null; },
    async discardReservation(reservation) {
      const deleted = await prisma.salesDemoSession.deleteMany({ where: { id: reservation.id, customerId: reservation.customerId, opportunityId: reservation.opportunityId, revision: reservation.revision, cloudShareSalesExperienceId: reservation.cloudShareSalesExperienceId, operationalStatus: "provisioning" } });
      return deleted.count === 1;
    },
    async listByOpportunity(customerId, opportunityId) { return (await prisma.salesDemoSession.findMany({ where: { customerId, opportunityId }, orderBy: { createdAt: "desc" } })).map(toDomain); },
    async updateOperationalState(customerId, id, state) {
      const updated = await prisma.salesDemoSession.updateMany({ where: { customerId, id }, data: state });
      if (updated.count !== 1) throw new Error("Sales Enablement Session was not found for this Customer");
    },
    async updateDisplayName(id, sessionName) { await prisma.salesDemoSession.update({ where: { id }, data: { sessionName } }); },
  };
}

function isSalesSessionRevisionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || (error as { code?: unknown }).code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  return Array.isArray(target) && target.length === 3 && target.includes("customerId") && target.includes("opportunityId") && target.includes("revision");
}

function toDomain(row: { id: string; customerId: string; opportunityId: string; itemId: string; cloudShareSalesExperienceId: string; externalId: string; type: string; start: string; end: string; timeZone: string; salesProEmail: string; salesProDisplayName: string; registrationType: string; sendInvitations: string; sessionName: string; revision: number; operationalStatus: string; attentionReason: string | null; experienceStatus?: string | null; experienceStatusObservedAt?: Date | null; createdAt: Date }): SalesDemoSession {
  return { ...row, type: row.type as SalesDemoSession["type"], operationalStatus: row.operationalStatus as NonNullable<SalesDemoSession["operationalStatus"]>, experienceStatus: row.experienceStatus === "notStarted" || row.experienceStatus === "inProgress" || row.experienceStatus === "ended" ? row.experienceStatus : null, registrationType: "registeredParticipantsOnly", sendInvitations: row.sendInvitations === "salesProsAndParticipants" ? "salesProsAndParticipants" : "dontSend" };
}
