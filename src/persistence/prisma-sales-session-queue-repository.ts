import type { Prisma, PrismaClient } from "@prisma/client";
import type { SalesSessionQueueCandidate, SalesSessionQueueSort, SalesSessionQueueView } from "@/domain/sales-session-queue";

export interface SalesSessionQueueRead {
  readonly customerId: string;
  readonly view: SalesSessionQueueView;
  readonly accountId?: string;
  readonly opportunityId?: string;
  readonly search?: string;
  readonly sort: SalesSessionQueueSort;
  readonly offset: number;
  readonly limit: number;
}
export interface SalesSessionQueuePage { readonly rows: readonly SalesSessionQueueCandidate[]; readonly total: number; }
export interface SalesSessionQueueRepository { read(input: SalesSessionQueueRead): Promise<SalesSessionQueuePage>; findTarget(customerId: string, id: string): Promise<{ readonly id: string; readonly archived: boolean } | null>; }

/**
 * One deliberately deep local queue seam. It owns the Customer predicate,
 * bounded ordering, relation filters, and the EXISTS condition for participant
 * environment attention. Browser callers never enumerate sessions or invoke
 * CloudShare to construct the workbench.
 */
export function createPrismaSalesSessionQueueRepository(prisma: PrismaClient): SalesSessionQueueRepository {
  return {
    async read(input) {
      const where = whereFor(input);
      const [total, rows] = await Promise.all([
        prisma.salesDemoSession.count({ where }),
        prisma.salesDemoSession.findMany({ where, orderBy: orderBy(input.sort), skip: input.offset, take: input.limit, include: { opportunity: { include: { account: true } }, participants: { where: { environmentAttentionReason: { not: null } }, include: { contact: true }, take: 1 } } }),
      ]);
      return { total, rows: rows.map((row) => ({
        id: row.id, customerId: row.customerId, opportunityId: row.opportunityId, itemId: row.itemId, cloudShareSalesExperienceId: row.cloudShareSalesExperienceId, externalId: row.externalId, type: row.type as SalesSessionQueueCandidate["type"], start: row.start, end: row.end, timeZone: row.timeZone, salesProEmail: row.salesProEmail, salesProDisplayName: row.salesProDisplayName, registrationType: "registeredParticipantsOnly", sendInvitations: row.sendInvitations === "salesProsAndParticipants" ? "salesProsAndParticipants" : "dontSend", sessionName: row.sessionName, revision: row.revision, operationalStatus: row.operationalStatus as SalesSessionQueueCandidate["operationalStatus"], attentionReason: row.attentionReason, experienceStatus: row.experienceStatus === "notStarted" || row.experienceStatus === "inProgress" || row.experienceStatus === "ended" ? row.experienceStatus : null, experienceStatusObservedAt: row.experienceStatusObservedAt, createdAt: row.createdAt, accountId: row.opportunity.accountId, accountName: row.opportunity.account.name, opportunityName: row.opportunity.name, participantAttention: row.participants[0] ? { participantName: `${row.participants[0].contact.firstName} ${row.participants[0].contact.lastName}`, reason: row.participants[0].environmentAttentionReason ?? "Participant Environment requires support." } : null,
      })) };
    },
    async findTarget(customerId, id) {
      const row = await prisma.salesDemoSession.findFirst({ where: { customerId, id }, select: { id: true, opportunity: { select: { archivedAt: true, account: { select: { archivedAt: true } } } } } });
      return row ? { id: row.id, archived: Boolean(row.opportunity.archivedAt || row.opportunity.account.archivedAt) } : null;
    },
  };
}

function whereFor(input: SalesSessionQueueRead): Prisma.SalesDemoSessionWhereInput {
  const terms: Prisma.SalesDemoSessionWhereInput[] = [{ customerId: input.customerId }];
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
