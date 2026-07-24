import type { Prisma, PrismaClient } from "@prisma/client";
import { belongsInSalesSessionQueue, classifySalesSessionQueueRow, projectQueueParticipantEnvironment, type SalesSessionQueueCandidate, type SalesSessionQueueSort, type SalesSessionQueueView } from "@/domain/sales-session-queue";

export interface SalesSessionQueueRead {
  readonly customerId: string;
  readonly view: SalesSessionQueueView;
  readonly accountId?: string;
  readonly opportunityId?: string;
  readonly search?: string;
  readonly sort: SalesSessionQueueSort;
  readonly offset: number;
  readonly limit: number;
  readonly now: Date;
}
export interface SalesSessionQueuePage { readonly rows: readonly SalesSessionQueueCandidate[]; readonly total: number; }
export interface SalesSessionQueueRepository { read(input: SalesSessionQueueRead): Promise<SalesSessionQueuePage>; findTarget(customerId: string, id: string): Promise<{ readonly id: string; readonly archived: boolean } | null>; }

/**
 * One deliberately deep local queue seam. It owns the Customer predicate,
 * bounded ordering, relation filters, the attention EXISTS predicate, and one
 * deterministic participant-environment projection per Session. Browser
 * callers never enumerate sessions or invoke CloudShare to construct the
 * workbench.
 */
export function createPrismaSalesSessionQueueRepository(prisma: PrismaClient): SalesSessionQueueRepository {
  return {
    async read(input) {
      const where = whereFor(input);
      const requiresWallClockClassification = input.view === "active" || input.view === "history";
      const rows = await prisma.salesDemoSession.findMany({ where, orderBy: orderBy(input.sort), skip: requiresWallClockClassification ? 0 : input.offset, take: requiresWallClockClassification ? 501 : input.limit, include: { opportunity: { include: { account: true } }, participants: { ...(input.view === "needs_attention" ? { where: { environmentAttentionReason: { not: null } } } : {}), include: { contact: true }, orderBy: [{ environmentObservedAt: "desc" }, { id: "asc" }], take: 1 } } });
      const candidates: SalesSessionQueueCandidate[] = rows.map((row) => ({
        id: row.id, customerId: row.customerId, opportunityId: row.opportunityId, itemId: row.itemId, cloudShareSalesExperienceId: row.cloudShareSalesExperienceId, externalId: row.externalId, type: row.type as SalesSessionQueueCandidate["type"], start: row.start, end: row.end, timeZone: row.timeZone, salesProEmail: row.salesProEmail, salesProDisplayName: row.salesProDisplayName, registrationType: "registeredParticipantsOnly" as const, sendInvitations: row.sendInvitations === "salesProsAndParticipants" ? "salesProsAndParticipants" : "dontSend", sessionName: row.sessionName, revision: row.revision, operationalStatus: row.operationalStatus as SalesSessionQueueCandidate["operationalStatus"], attentionReason: row.attentionReason, experienceStatus: row.experienceStatus === "notStarted" || row.experienceStatus === "inProgress" || row.experienceStatus === "ended" ? row.experienceStatus : null, experienceStatusObservedAt: row.experienceStatusObservedAt, createdAt: row.createdAt, accountId: row.opportunity.accountId, accountName: row.opportunity.account.name, opportunityName: row.opportunity.name, participantEnvironment: row.participants[0] ? projectQueueParticipantEnvironment({ participantName: `${row.participants[0].contact.firstName} ${row.participants[0].contact.lastName}`, environmentStatus: row.participants[0].environmentStatus, environmentStatusCode: row.participants[0].environmentStatusCode, environmentObservedAt: row.participants[0].environmentObservedAt, attentionReason: row.participants[0].environmentAttentionReason }) : null,
      }));
      if (requiresWallClockClassification) {
        const matching = candidates.filter((candidate) => belongsInSalesSessionQueue(classifySalesSessionQueueRow(candidate, input.now), input.view));
        return { total: matching.length, rows: matching.slice(input.offset, input.offset + input.limit) };
      }
      return { total: await prisma.salesDemoSession.count({ where }), rows: candidates };
    },
    async findTarget(customerId, id) {
      const row = await prisma.salesDemoSession.findFirst({ where: { customerId, id }, select: { id: true, opportunity: { select: { archivedAt: true, account: { select: { archivedAt: true } } } } } });
      return row ? { id: row.id, archived: Boolean(row.opportunity.archivedAt || row.opportunity.account.archivedAt) } : null;
    },
  };
}

function whereFor(input: SalesSessionQueueRead): Prisma.SalesDemoSessionWhereInput {
  const terms: Prisma.SalesDemoSessionWhereInput[] = [{ customerId: input.customerId }, { opportunity: { archivedAt: null, account: { archivedAt: null } } }];
  if (input.accountId) terms.push({ opportunity: { accountId: input.accountId } });
  if (input.opportunityId) terms.push({ opportunityId: input.opportunityId });
  if (input.search) terms.push({ OR: [{ sessionName: { contains: input.search } }, { opportunity: { name: { contains: input.search } } }, { opportunity: { account: { name: { contains: input.search } } } }] });
  if (input.view === "needs_attention") terms.push({ OR: [{ operationalStatus: "needs_attention" }, { participants: { some: { environmentAttentionReason: { not: null } } } }] });
  return { AND: terms };
}

function orderBy(sort: SalesSessionQueueSort): Prisma.SalesDemoSessionOrderByWithRelationInput[] {
  if (sort === "start_asc") return [{ start: "asc" }, { id: "asc" }];
  if (sort === "name_asc") return [{ sessionName: "asc" }, { id: "asc" }];
  return [{ start: "desc" }, { id: "asc" }];
}
