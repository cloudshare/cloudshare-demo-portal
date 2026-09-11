import type { PrismaClient } from "@prisma/client";
import { projectSalesSessionStatus } from "@/domain/sales-session-status";
import { groupSafeSalesSessionActivity, projectSafeSalesParticipantAttention, projectSafeSalesParticipantEnvironment, projectSafeSalesSessionActivity, type SalesSessionWorkspaceRead } from "@/domain/sales-session-workspace";

export interface SalesSessionWorkspaceRepository {
  /** Returns a single safe, local projection or null. Customer and archived-record
   * predicates are intentionally owned here so ordinary callers cannot weaken them. */
  read(customerId: string, sessionId: string): Promise<SalesSessionWorkspaceRead | null>;
}

/** The read probe is 5,501 rows; presentation is capped at 5,500 complete
 * workflow groups, never raw rows. This preserves correlation histories when
 * a workflow spans the probe boundary and reports omission metadata honestly. */
const MAX_PRESENTED_ACTIVITY_GROUPS = 5500;

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
        experienceStatusSource: session.experienceStatusSource === "cloudshare_v4_sales_list" || session.experienceStatusSource === "cloudshare_v4_get_sales" ? session.experienceStatusSource : null,
      }, new Date());
      const activity = await prisma.diagnosticLogEntry.findMany({
        // Read the complete local history before the UI applies presentation
        // grouping/limits. A fixed query limit can split one workflow and make
        // the resulting Activity timeline materially misleading.
        where: { customerId, subjectId: session.id, subjectType: "sales_demo_session" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 5501,
        select: { occurredAt: true, operation: true, outcome: true, actorType: true, subjectType: true, subjectId: true, correlationId: true },
      });
      const projectedActivity = activity.map((entry) => projectSafeSalesSessionActivity(entry, session.id)).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const allActivityGroups = groupSafeSalesSessionActivity(projectedActivity);
      const activityGroups = allActivityGroups.slice(0, MAX_PRESENTED_ACTIVITY_GROUPS);
      const omittedGroupCount = Math.max(0, allActivityGroups.length - activityGroups.length);
      return { state: "available", workspace: {
        summary: { id: session.id, sessionName: session.sessionName || "Sales Enablement Session", revision: session.revision, start: session.start, end: session.end, timeZone: session.timeZone, operation: status.operation, experience: status.experience },
        participants: session.participants.map((participant) => ({ id: participant.id, name: `${participant.contact.firstName} ${participant.contact.lastName}`, email: participant.contact.email, invitationStatus: participant.invitationStatus === "sent" ? "sent" : "notSent", participationStatus: participant.participationStatus, environment: projectSafeSalesParticipantEnvironment(participant), environmentAttention: projectSafeSalesParticipantAttention(participant) })),
        activity: projectedActivity,
        activityGroups,
        activityHistory: { complete: activity.length <= 5500 && omittedGroupCount === 0, omittedCount: activity.length > 5500 ? activity.length - 5500 : omittedGroupCount, presentedGroupCount: activityGroups.length, totalGroupCount: allActivityGroups.length, partialGroups: activity.length > 5500 ? 1 : 0 },
        details: { accountName: session.opportunity.account.name, opportunityName: session.opportunity.name, itemName: session.item.name, invitationMode: session.sendInvitations === "salesProsAndParticipants" ? "Sales Pros and participants" : "No native invitations" },
      } };
    },
  };
}
