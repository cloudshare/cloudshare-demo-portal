import type { PrismaClient } from "@prisma/client";
import { projectSalesSessionStatus } from "@/domain/sales-session-status";

export interface SalesSessionWorkspaceRepository {
  /** Returns a single safe, local projection or null. Customer and archived-record
   * predicates are intentionally owned here so ordinary callers cannot weaken them. */
  read(customerId: string, sessionId: string): Promise<Record<string, unknown> | null>;
}

/**
 * The Session workspace's deep local read seam. It joins the persisted Sales
 * relationship and participants, derives the independent operation and
 * Experience projections, and selects diagnostic metadata columns only. It
 * never reads provider fields, protected diagnostic JSON, or a CloudShare API.
 */
export function createPrismaSalesSessionWorkspaceRepository(prisma: PrismaClient): SalesSessionWorkspaceRepository {
  return {
    async read(customerId, sessionId) {
      const session = await prisma.salesDemoSession.findFirst({
        where: { customerId, id: sessionId, opportunity: { archivedAt: null, account: { archivedAt: null } } },
        include: { opportunity: { include: { account: true } }, item: true, participants: { include: { contact: true }, orderBy: { createdAt: "asc" } } },
      });
      if (!session) return null;
      const status = projectSalesSessionStatus({
        start: session.start, end: session.end, timeZone: session.timeZone,
        operationalStatus: session.operationalStatus === "provisioning" || session.operationalStatus === "needs_attention" ? session.operationalStatus : "active",
        attentionReason: session.attentionReason,
        experienceStatus: session.experienceStatus === "notStarted" || session.experienceStatus === "inProgress" || session.experienceStatus === "ended" ? session.experienceStatus : null,
        experienceStatusObservedAt: session.experienceStatusObservedAt,
      }, new Date());
      const activity = await prisma.diagnosticLogEntry.findMany({
        where: { customerId, subjectId: session.id }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100,
        select: { occurredAt: true, operation: true, outcome: true, message: true, actorType: true, actorEmail: true, subjectType: true, subjectId: true, correlationId: true },
      });
      return {
        summary: { id: session.id, sessionName: session.sessionName || "Sales Enablement Session", revision: session.revision, start: session.start, end: session.end, timeZone: session.timeZone, operation: status.operation, experience: status.experience },
        participants: session.participants.map((participant) => ({ id: participant.id, name: `${participant.contact.firstName} ${participant.contact.lastName}`, email: participant.contact.email, invitationStatus: participant.invitationStatus === "sent" ? "sent" : "notSent", participationStatus: participant.participationStatus })),
        activity: activity.map((entry) => ({ occurredAt: entry.occurredAt.toISOString(), operation: entry.operation, outcome: entry.outcome, message: entry.message, actor: entry.actorType ? { type: entry.actorType, ...(entry.actorEmail ? { email: entry.actorEmail } : {}) } : null, subject: entry.subjectType && entry.subjectId ? { type: entry.subjectType, id: entry.subjectId } : null, ...(entry.correlationId ? { correlationId: entry.correlationId } : {}) })),
        details: { accountName: session.opportunity.account.name, opportunityName: session.opportunity.name, itemName: session.item.name, invitationMode: session.sendInvitations === "salesProsAndParticipants" ? "Sales Pros and participants" : "No native invitations" },
      };
    },
  };
}
