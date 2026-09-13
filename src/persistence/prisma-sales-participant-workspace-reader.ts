import type { PrismaClient } from "@prisma/client";
import type {
  SalesParticipantWorkspaceBasePage,
  SalesParticipantWorkspaceBaseReader,
} from "@/domain/sales-participant-workspace";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import type { SalesParticipantLaunchOperationKind, SalesParticipantLaunchOutcome } from "@/domain/sales-participant-launch-operation";
import { isProjectableSalesParticipantRosterEnvironment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "@/domain/sales-participant-environment";

const launchOperations = new Set<SalesParticipantLaunchOperationKind>(["generate", "revoke"]);
const launchOutcomes = new Set<SalesParticipantLaunchOutcome>(["success", "failure"]);
const participationStatuses = new Set(["pending", "inProgress", "concluded"] as const);
const v3EnvironmentStatusCodes = new Set([0, 2, 3, 4, 5, 7, 8, 9]);
const environmentAttentionReasons = new Set(["environment_ambiguous_for_project", "environment_not_found_for_project"]);

function safeLaunchOperation(value: { operation: string; outcome: string; safeReason: string | null; correlationId: string } | undefined) {
  if (!value || !launchOperations.has(value.operation as SalesParticipantLaunchOperationKind) || !launchOutcomes.has(value.outcome as SalesParticipantLaunchOutcome) || (value.safeReason !== null && value.safeReason !== "persistence_failure")) return null;
  return { operation: value.operation as SalesParticipantLaunchOperationKind, outcome: value.outcome as SalesParticipantLaunchOutcome, reason: value.safeReason as "persistence_failure" | null, correlationId: value.correlationId };
}
export function createPrismaSalesParticipantWorkspaceReader(
  prisma: PrismaClient,
): SalesParticipantWorkspaceBaseReader {
  return {
    async readPage(input) {
      const session = await prisma.salesDemoSession.findFirst({
        where: { id: input.sessionId, customerId: input.customerId, opportunity: { archivedAt: null, account: { archivedAt: null } } },
        select: { id: true, opportunityId: true, end: true, timeZone: true, sendInvitations: true },
      });
      if (!session) return null;
      const sessionEnd = cloudShareWallClockToInstant(session.end, session.timeZone);
      if (!sessionEnd) return null;
      // Prisma's SQLite connector does not support the `mode` filter modifier.
      // SQLite LIKE is case-insensitive for the ASCII contact data used by the
      // portal, so `contains` gives the required bounded name/email search
      // without widening the query to raw SQL.
      const where = {
        customerId: input.customerId,
        salesDemoSessionId: input.sessionId,
        contact: {
          archivedAt: null,
          opportunity: { archivedAt: null },
          ...(input.query
            ? {
                OR: [
                  { firstName: { contains: input.query } },
                  { lastName: { contains: input.query } },
                  { email: { contains: input.query } },
                ],
              }
            : {}),
        },
      };
      const [total, rows, eligible] = await Promise.all([
        prisma.salesSessionParticipant.count({ where }),
        prisma.salesSessionParticipant.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: input.offset,
          take: input.limit,
          select: {
            id: true,
            updatedAt: true,
            invitationStatus: true,
            participationStatus: true,
            cloudShareParticipantId: true,
            environmentStatus: true,
            environmentStatusCode: true,
            environmentObservedAt: true,
            environmentAttentionReason: true,
            environmentAttentionSource: true,
            contact: {
              select: { firstName: true, lastName: true, email: true },
            },
            launchLinks: {
              where: { revokedAt: null },
              select: { id: true },
              take: 1,
            },
          },
        }),
        prisma.opportunityContact.findMany({
          where: { customerId: input.customerId, opportunityId: session.opportunityId, archivedAt: null, opportunity: { archivedAt: null, account: { archivedAt: null } }, salesSessionParticipants: { none: { customerId: input.customerId, salesDemoSessionId: input.sessionId } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50,
          select: { id: true, firstName: true, lastName: true, email: true },
        }),
      ]);
      const participantIds = rows.map((row) => row.id);
      // Query one row per bounded page participant. Prisma distinct may be
      // applied in memory, which can read an unbounded operation history.
      const launchOperations = (
        await Promise.all(
          participantIds.map((participantId) =>
            prisma.salesParticipantLaunchOperation.findMany({
              where: {
                customerId: input.customerId,
                salesDemoSessionId: input.sessionId,
                salesSessionParticipantId: participantId,
              },
              orderBy: [
                { occurredAt: "desc" },
                { revision: "desc" },
                { id: "desc" },
              ],
              take: 1,
              select: {
                salesSessionParticipantId: true,
                operation: true,
                outcome: true,
                safeReason: true,
                correlationId: true,
              },
            }),
          ),
        )
      ).flat();
      const launchByParticipant = new Map(launchOperations.map((operation) => [operation.salesSessionParticipantId, operation]));
      const page: SalesParticipantWorkspaceBasePage = {
        total,
        offset: input.offset,
        limit: input.limit,
        hasMore: input.offset + rows.length < total,
        participants: rows.map((row) => {
          const launch = launchByParticipant.get(row.id);
          if (!participationStatuses.has(row.participationStatus as "pending" | "inProgress" | "concluded")) throw new Error("Invalid persisted Participant participation status.");
          if (row.invitationStatus !== "sent" && row.invitationStatus !== "notSent") throw new Error("Invalid persisted Participant invitation status.");
          if (row.environmentStatus !== null && !isProjectableSalesParticipantRosterEnvironment(row.environmentStatus)) throw new Error("Invalid persisted Participant Environment status.");
          if (row.environmentStatusCode !== null && row.environmentStatusCode !== undefined && !v3EnvironmentStatusCodes.has(row.environmentStatusCode)) throw new Error("Invalid persisted Participant Environment status code.");
          const hasEnvironmentAttentionReason = row.environmentAttentionReason !== null && row.environmentAttentionReason !== undefined;
          const hasEnvironmentAttentionSource = row.environmentAttentionSource !== null && row.environmentAttentionSource !== undefined;
          if ((hasEnvironmentAttentionReason && !environmentAttentionReasons.has(row.environmentAttentionReason ?? "")) || hasEnvironmentAttentionReason !== hasEnvironmentAttentionSource || (hasEnvironmentAttentionSource && row.environmentAttentionSource !== "cloudshare_v3_owner_email_item_project")) throw new Error("Invalid persisted Participant Environment attention state.");
          const environment = isProjectableSalesParticipantRosterEnvironment(row.environmentStatus) && row.environmentObservedAt
            ? projectSalesParticipantRosterEnvironment(row.environmentStatus, row.environmentObservedAt)
            : projectSalesParticipantEnvironment(row.environmentStatusCode, row.environmentObservedAt ?? undefined);
          return {
            id: row.id,
            participantRevision: row.updatedAt.toISOString(),
            name: `${row.contact.firstName} ${row.contact.lastName}`.trim(),
            email: row.contact.email,
            invitationStatus: row.invitationStatus === "sent" ? "sent" : "notSent",
            participationStatus: row.participationStatus as "pending" | "inProgress" | "concluded",
            sessionEndsAt: sessionEnd.toISOString(),
            nativeInvitationsEnabled:
              session.sendInvitations === "salesProsAndParticipants",
            providerCorrelation: Boolean(row.cloudShareParticipantId),
            activeLaunchCapability: row.launchLinks.length > 0,
            launchOperation: safeLaunchOperation(launch),
            environment,
            environmentAttention: row.environmentAttentionReason
              ? {
                  reason: "Participant Environment requires support review.",
                  source: row.environmentAttentionSource ?? "Certalis correlation",
                }
              : null,
          };
        }),
        eligibleContacts: eligible.map((contact) => ({ id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim(), email: contact.email })),
      };
      return page;
    },
  };
}
