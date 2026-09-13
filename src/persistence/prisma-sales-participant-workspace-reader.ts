import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantWorkspacePage, SalesParticipantWorkspaceReader } from "@/domain/sales-participant-workspace";
export function createPrismaSalesParticipantWorkspaceReader(prisma: PrismaClient): SalesParticipantWorkspaceReader {
  return { async readPage(input) {
    const session = await prisma.salesDemoSession.findFirst({ where: { id: input.sessionId, customerId: input.customerId }, select: { id: true, end: true, sendInvitations: true } });
    if (!session) return null;
    // Prisma's SQLite connector does not support the `mode` filter modifier.
    // SQLite LIKE is case-insensitive for the ASCII contact data used by the
    // portal, so `contains` gives the required bounded name/email search
    // without widening the query to raw SQL.
    const where = { customerId: input.customerId, salesDemoSessionId: input.sessionId, contact: { archivedAt: null, opportunity: { archivedAt: null }, ...(input.query ? { OR: [{ firstName: { contains: input.query } }, { lastName: { contains: input.query } }, { email: { contains: input.query } }] } : {}) } };
    const [total, rows] = await Promise.all([prisma.salesSessionParticipant.count({ where }), prisma.salesSessionParticipant.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: input.offset, take: input.limit, select: { id: true, updatedAt: true, invitationStatus: true, participationStatus: true, cloudShareParticipantId: true, cloudShareRosterEnvironmentReference: true, environmentStatus: true, environmentObservedAt: true, environmentAttentionReason: true, contact: { select: { firstName: true, lastName: true, email: true } }, launchLinks: { where: { revokedAt: null }, select: { id: true }, take: 1 } } })]);
    const participantIds = rows.map((row) => row.id);
    const fences = participantIds.length ? await prisma.salesParticipantInvitationFence.findMany({ where: { customerId: input.customerId, salesSessionParticipantId: { in: participantIds } }, select: { salesSessionParticipantId: true, commandId: true, revision: true } }) : [];
    const commandIds = fences.map((fence) => fence.commandId);
    const commands = commandIds.length ? await prisma.salesParticipantInvitationCommand.findMany({ where: { customerId: input.customerId, commandId: { in: commandIds }, sessionId: input.sessionId }, select: { commandId: true, phase: true, revision: true, correlationId: true, targets: { select: { salesSessionParticipantId: true, outcome: true, reason: true } } } }) : [];
    const commandById = new Map(commands.map((command) => [command.commandId, command]));
    const fenceByParticipant = new Map(fences.map((fence) => [fence.salesSessionParticipantId, fence]));
    const latestTargets = participantIds.length ? await prisma.salesParticipantInvitationTarget.findMany({ where: { customerId: input.customerId, salesSessionParticipantId: { in: participantIds }, command: { sessionId: input.sessionId } }, orderBy: [{ command: { updatedAt: "desc" } }, { ordinal: "asc" }], take: Math.min(500, participantIds.length * 10), select: { salesSessionParticipantId: true, outcome: true, reason: true, command: { select: { correlationId: true } } } }) : [];
    const latestByParticipant = new Map<string, (typeof latestTargets)[number]>();
    for (const target of latestTargets) if (!latestByParticipant.has(target.salesSessionParticipantId)) latestByParticipant.set(target.salesSessionParticipantId, target);
    const page: SalesParticipantWorkspacePage = { total, offset: input.offset, limit: input.limit, hasMore: input.offset + rows.length < total, participants: rows.map((row) => {
      const fence = fenceByParticipant.get(row.id);
      const command = fence ? commandById.get(fence.commandId) : undefined;
      const outcomes = command?.targets.filter((target) => target.salesSessionParticipantId === row.id) ?? [];
      const outcome = outcomes.find((target) => target.outcome)?.outcome ?? null;
      const reason = outcomes.find((target) => target.reason)?.reason ?? null;
      const latest = latestByParticipant.get(row.id);
      return { id: row.id, participantRevision: row.updatedAt.toISOString(), name: `${row.contact.firstName} ${row.contact.lastName}`.trim(), email: row.contact.email, invitationStatus: row.invitationStatus === "sent" ? "sent" : "notSent", participationStatus: row.participationStatus, sessionEndsAt: session.end, nativeInvitationsEnabled: session.sendInvitations === "salesProsAndParticipants", providerCorrelation: Boolean(row.cloudShareParticipantId), activeLaunchCapability: row.launchLinks.length > 0, currentCommandId: command?.commandId ?? null, invitationOutcome: outcome, invitationReason: reason, invitationCorrelationId: command?.correlationId ?? null, invitationRevision: command?.revision ?? null, latestInvitationOutcome: latest?.outcome ?? null, latestInvitationReason: latest?.reason ?? null, latestInvitationCorrelationId: latest?.command.correlationId ?? null, launchOperation: null, environment: { value: row.environmentStatus, source: row.environmentStatus ? "cloudshare_v4_sales_participant_roster" : row.cloudShareRosterEnvironmentReference ? "not_observed" : "not_assigned", ...(row.environmentObservedAt ? { observedAt: row.environmentObservedAt.toISOString() } : {}) }, environmentAttention: row.environmentAttentionReason ? { reason: "Participant Environment requires support review.", source: "Certalis correlation" } : null };
    }) };
    return page;
  } };
}
