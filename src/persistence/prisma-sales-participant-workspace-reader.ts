import type { PrismaClient } from "@prisma/client";
import type {
  SalesParticipantWorkspacePage,
  SalesParticipantWorkspaceReader,
} from "@/domain/sales-participant-workspace";
import { cloudShareWallClockToInstant } from "@/domain/cloudshare-wall-clock";
import { invitationOutcomes, type InvitationOutcome, type InvitationSafeReason } from "@/domain/sales-participant-invitation-ledger";
import type { SalesParticipantLaunchOperationKind, SalesParticipantLaunchOutcome } from "@/domain/sales-participant-launch-operation";

const invitationSafeReasons = new Set<InvitationSafeReason>(["provider_rejected", "ambiguous_after_dispatch", "confirmation_required", "failed_retryable", "stale_revision", "blocked_by_fence"]);
const launchOperations = new Set<SalesParticipantLaunchOperationKind>(["generate", "revoke"]);
const launchOutcomes = new Set<SalesParticipantLaunchOutcome>(["success", "failure"]);

function invitationOutcome(value: string | null | undefined): InvitationOutcome | null {
  return invitationOutcomes.includes(value as InvitationOutcome) ? value as InvitationOutcome : null;
}
function invitationReason(value: string | null | undefined): InvitationSafeReason | null {
  return invitationSafeReasons.has(value as InvitationSafeReason) ? value as InvitationSafeReason : null;
}
function safeLaunchOperation(value: { operation: string; outcome: string; safeReason: string | null; correlationId: string } | undefined) {
  if (!value || !launchOperations.has(value.operation as SalesParticipantLaunchOperationKind) || !launchOutcomes.has(value.outcome as SalesParticipantLaunchOutcome) || (value.safeReason !== null && value.safeReason !== "persistence_failure")) return null;
  return { operation: value.operation as SalesParticipantLaunchOperationKind, outcome: value.outcome as SalesParticipantLaunchOutcome, reason: value.safeReason as "persistence_failure" | null, correlationId: value.correlationId };
}
export function createPrismaSalesParticipantWorkspaceReader(
  prisma: PrismaClient,
): SalesParticipantWorkspaceReader {
  return {
    async readPage(input) {
      const session = await prisma.salesDemoSession.findFirst({
        where: { id: input.sessionId, customerId: input.customerId, opportunity: { archivedAt: null, account: { archivedAt: null } } },
        select: { id: true, end: true, timeZone: true, sendInvitations: true },
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
      const [total, rows] = await Promise.all([
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
            environmentObservedAt: true,
            environmentAttentionReason: true,
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
      ]);
      const participantIds = rows.map((row) => row.id);
      const fences = participantIds.length
        ? await prisma.salesParticipantInvitationFence.findMany({
            where: {
              customerId: input.customerId,
              salesSessionParticipantId: { in: participantIds },
            },
            select: {
              salesSessionParticipantId: true,
              commandId: true,
              revision: true,
            },
          })
        : [];
      const commandIds = fences.map((fence) => fence.commandId);
      const commands = commandIds.length
        ? await prisma.salesParticipantInvitationCommand.findMany({
            where: {
              customerId: input.customerId,
              commandId: { in: commandIds },
              sessionId: input.sessionId,
            },
            select: {
              commandId: true,
              phase: true,
              revision: true,
              correlationId: true,
              targets: {
                select: {
                  salesSessionParticipantId: true,
                  outcome: true,
                  reason: true,
                },
              },
            },
          })
        : [];
      const commandById = new Map(
        commands.map((command) => [command.commandId, command]),
      );
      const fenceByParticipant = new Map(
        fences.map((fence) => [fence.salesSessionParticipantId, fence]),
      );
      const latestTargets = (
        await Promise.all(
          participantIds.map((participantId) =>
            prisma.salesParticipantInvitationTarget.findMany({
              where: {
                customerId: input.customerId,
                salesSessionParticipantId: participantId,
                command: { sessionId: input.sessionId },
              },
              orderBy: [{ command: { updatedAt: "desc" } }, { ordinal: "asc" }],
              take: 1,
              select: {
                salesSessionParticipantId: true,
                outcome: true,
                reason: true,
                command: { select: { correlationId: true } },
              },
            }),
          ),
        )
      ).flat();
      const latestByParticipant = new Map<
        string,
        (typeof latestTargets)[number]
      >();
      for (const target of latestTargets)
        if (!latestByParticipant.has(target.salesSessionParticipantId))
          latestByParticipant.set(target.salesSessionParticipantId, target);
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
      const page: SalesParticipantWorkspacePage = {
        total,
        offset: input.offset,
        limit: input.limit,
        hasMore: input.offset + rows.length < total,
        participants: rows.map((row) => {
          const fence = fenceByParticipant.get(row.id);
          const command = fence ? commandById.get(fence.commandId) : undefined;
          const outcomes =
            command?.targets.filter(
              (target) => target.salesSessionParticipantId === row.id,
            ) ?? [];
          const outcome = invitationOutcome(outcomes.find((target) => target.outcome)?.outcome);
          const reason = outcome ? invitationReason(outcomes.find((target) => target.reason)?.reason) : null;
          const latest = latestByParticipant.get(row.id);
          const launch = launchByParticipant.get(row.id);
          const latestOutcome = invitationOutcome(latest?.outcome);
          return {
            id: row.id,
            participantRevision: row.updatedAt.toISOString(),
            name: `${row.contact.firstName} ${row.contact.lastName}`.trim(),
            email: row.contact.email,
            invitationStatus:
              row.invitationStatus === "sent" ? "sent" : "notSent",
            participationStatus: row.participationStatus,
            sessionEndsAt: sessionEnd.toISOString(),
            nativeInvitationsEnabled:
              session.sendInvitations === "salesProsAndParticipants",
            providerCorrelation: Boolean(row.cloudShareParticipantId),
            activeLaunchCapability: row.launchLinks.length > 0,
            currentCommandId: command?.commandId ?? null,
            invitationOutcome: outcome,
            invitationReason: reason,
            invitationCorrelationId: command?.correlationId ?? null,
            invitationRevision: command?.revision ?? null,
            latestInvitationOutcome: latestOutcome,
            latestInvitationReason: latestOutcome ? invitationReason(latest?.reason) : null,
            latestInvitationCorrelationId:
              latest?.command.correlationId ?? null,
            launchOperation: safeLaunchOperation(launch),
            environment: {
              value: row.environmentStatus,
              source: row.environmentStatus ? "cloudshare_v4_sales_participant_roster" : "not_observed",
              ...(row.environmentObservedAt
                ? { observedAt: row.environmentObservedAt.toISOString() }
                : {}),
            },
            environmentAttention: row.environmentAttentionReason
              ? {
                  reason: "Participant Environment requires support review.",
                  source: "Certalis correlation",
                }
              : null,
          };
        }),
      };
      return page;
    },
  };
}
