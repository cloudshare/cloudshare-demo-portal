import type { PrismaClient } from "@prisma/client";
import { projectSalesSessionStatus } from "@/domain/sales-session-status";
import { groupSafeSalesSessionActivity, projectSafeSalesParticipantAttention, projectSafeSalesParticipantEnvironment, projectSafeSalesSessionActivity, type SalesSessionWorkspaceRead } from "@/domain/sales-session-workspace";

export interface SalesSessionWorkspaceRepository {
  /** Returns a single safe, local projection or null. Customer and archived-record
   * predicates are intentionally owned here so ordinary callers cannot weaken them. */
  read(customerId: string, sessionId: string): Promise<SalesSessionWorkspaceRead | null>;
}

/** The source scan is bounded, then a separate workflow presentation limit is applied. */
const SOURCE_SCAN_LIMIT = 5500;
const MAX_PRESENTED_ACTIVITY_GROUPS = 100;

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
        include: { opportunity: { include: { account: true } }, item: true },
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
        where: { customerId, subjectId: session.id, subjectType: "sales_demo_session" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: SOURCE_SCAN_LIMIT + 1,
        select: { id: true, occurredAt: true, operation: true, outcome: true, actorType: true, subjectType: true, subjectId: true, correlationId: true },
      });
      // The final row is a probe, never presentation data.  Keep the probe's
      // correlation so a displayed group can truthfully be marked incomplete
      // when its history continues beyond the read boundary.
      const sourceCapped = activity.length > SOURCE_SCAN_LIMIT;
      const probe = sourceCapped ? activity[SOURCE_SCAN_LIMIT] : undefined;
      const presentedRows = activity.slice(0, SOURCE_SCAN_LIMIT);
      const explicitAmbiguousCorrelation = session.operationalStatus === "needs_attention" ? session.attentionReason?.match(/cloudshare_v4_post_sales_ambiguous[\s\S]*?correlationId:([^\s]+)/)?.[1] : undefined;
      const legacyAmbiguous = session.operationalStatus === "needs_attention" && session.attentionReason?.includes("cloudshare_v4_post_sales_ambiguous") === true && !explicitAmbiguousCorrelation;
      const legacyAmbiguousCorrelations = legacyAmbiguous
        ? new Set(presentedRows.filter((entry) => entry.operation === "sales.demo_session.created" && entry.outcome === "failure" && entry.correlationId).map((entry) => entry.correlationId as string))
        : new Set<string>();
      const projectedActivity = presentedRows.map((entry) => projectSafeSalesSessionActivity({ ...entry, sessionCreationAmbiguous: Boolean((explicitAmbiguousCorrelation && entry.correlationId === explicitAmbiguousCorrelation) || legacyAmbiguousCorrelations.has(entry.correlationId ?? "")) }, session.id)).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      // Cancellation admission and completion share diagnostic metadata. Only
      // the exact durable command can establish completion; messages stay private.
      const cancellationCorrelations = [...new Set(presentedRows.filter((entry) => entry.operation === "sales.demo_session.cancel" && entry.correlationId).map((entry) => entry.correlationId!))];
      const completedCancellations = new Set<string>();
      if (cancellationCorrelations.length) {
        const commands = await prisma.salesParticipantExtensionCommand.findMany({
          where: { customerId, sessionId: session.id, operation: "cancellation", commandId: { in: cancellationCorrelations } },
          select: { customerId: true, sessionId: true, commandId: true, operation: true, state: true },
        });
        for (const command of commands) {
          if (command.customerId !== customerId || command.sessionId !== session.id || command.operation !== "cancellation" || !cancellationCorrelations.includes(command.commandId)) continue;
          let state;
          try { state = JSON.parse(command.state); } catch { continue; }
          if (state?.customerId === customerId && state.sessionId === session.id && state.commandId === command.commandId && state.experienceId === session.cloudShareSalesExperienceId && state.finished === true && (state.deletion ? state.deletion.state === "confirmed" : state.accessState === "confirmed")) completedCancellations.add(command.commandId);
        }
      }
      const allActivityGroups = groupSafeSalesSessionActivity(projectedActivity).map((group) =>
        probe ? { ...group, outcome: "incomplete" as const, summary: "Business outcome and evidence are incomplete." }
          : group.correlationId && completedCancellations.has(group.correlationId)
            ? { ...group, outcome: "success" as const, summary: "Sales Session cancelled." } : group,
      );
      const activityGroups = allActivityGroups.slice(0, MAX_PRESENTED_ACTIVITY_GROUPS);
      const presentationCapped = allActivityGroups.length > MAX_PRESENTED_ACTIVITY_GROUPS;
      return { state: "available", workspace: {
        summary: { id: session.id, sessionName: session.sessionName || "Sales Enablement Session", revision: session.revision, start: session.start, end: session.end, timeZone: session.timeZone, operation: status.operation, experience: status.experience },
        activity: projectedActivity,
        activityGroups,
        activityHistory: sourceCapped
          ? { complete: false, hasMore: true, reason: "source_scan_limit", presentedWorkflowCount: activityGroups.length }
          : presentationCapped
            ? { complete: false, hasMore: true, reason: "workflow_presentation_limit", presentedWorkflowCount: activityGroups.length, totalWorkflowCount: allActivityGroups.length }
            : { complete: true, hasMore: false, presentedWorkflowCount: activityGroups.length, totalWorkflowCount: allActivityGroups.length },
        details: { accountName: session.opportunity.account.name, opportunityName: session.opportunity.name, itemName: session.item.name, invitationMode: session.sendInvitations === "salesProsAndParticipants" ? "Sales Pros and participants" : "No native invitations" },
      } };
    },
  };
}
