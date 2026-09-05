import type { PrismaClient } from "@prisma/client";
import { projectSalesSessionStatus } from "@/domain/sales-session-status";
import { projectSafeSalesParticipantAttention, projectSafeSalesParticipantEnvironment, projectSafeSalesSessionActivity, type SalesSessionWorkspaceRead } from "@/domain/sales-session-workspace";

export interface SalesSessionWorkspaceRepository {
  /** Returns a single safe, local projection or null. Customer and archived-record
   * predicates are intentionally owned here so ordinary callers cannot weaken them. */
  read(customerId: string, sessionId: string): Promise<SalesSessionWorkspaceRead | null>;
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
      // A pending reference is a pre-dispatch reservation. It cannot safely be
      // treated as a real Sales Experience or a valid workspace target.
      if (session.operationalStatus === "provisioning" && session.cloudShareSalesExperienceId.startsWith("pending:")) return { state: "stale" };
      const status = projectSalesSessionStatus({
        start: session.start, end: session.end, timeZone: session.timeZone,
        operationalStatus: session.operationalStatus === "provisioning" || session.operationalStatus === "needs_attention" ? session.operationalStatus : "active",
        attentionReason: session.attentionReason,
        experienceStatus: session.experienceStatus === "notStarted" || session.experienceStatus === "inProgress" || session.experienceStatus === "ended" ? session.experienceStatus : null,
        experienceStatusObservedAt: session.experienceStatusObservedAt,
      }, new Date());
      const activity = await prisma.diagnosticLogEntry.findMany({
        where: { customerId, subjectId: session.id, subjectType: { in: ["sales_demo_session", "sales_participant"] } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100,
        select: { occurredAt: true, operation: true, outcome: true, actorType: true, subjectType: true, subjectId: true, correlationId: true },
      });
      return { state: "available", workspace: {
        summary: { id: session.id, sessionName: session.sessionName || "Sales Enablement Session", revision: session.revision, start: session.start, end: session.end, timeZone: session.timeZone, operation: status.operation, experience: status.experience },
        participants: session.participants.map((participant) => ({ id: participant.id, name: `${participant.contact.firstName} ${participant.contact.lastName}`, email: participant.contact.email, invitationStatus: participant.invitationStatus === "sent" ? "sent" : "notSent", participationStatus: participant.participationStatus, environment: projectSafeSalesParticipantEnvironment(participant), environmentAttention: projectSafeSalesParticipantAttention(participant) })),
        activity: activity.map((entry) => projectSafeSalesSessionActivity(entry, session.id)).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        details: { accountName: session.opportunity.account.name, opportunityName: session.opportunity.name, itemName: session.item.name, invitationMode: session.sendInvitations === "salesProsAndParticipants" ? "Sales Pros and participants" : "No native invitations" },
      } };
    },
  };
}
