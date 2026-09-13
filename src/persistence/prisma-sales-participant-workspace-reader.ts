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
    const page: SalesParticipantWorkspacePage = { total, offset: input.offset, limit: input.limit, hasMore: input.offset + rows.length < total, participants: rows.map((row) => ({ id: row.id, participantRevision: row.updatedAt.toISOString(), name: `${row.contact.firstName} ${row.contact.lastName}`.trim(), email: row.contact.email, invitationStatus: row.invitationStatus === "sent" ? "sent" : "notSent", participationStatus: row.participationStatus, sessionEndsAt: session.end, nativeInvitationsEnabled: session.sendInvitations === "salesProsAndParticipants", providerCorrelation: Boolean(row.cloudShareParticipantId), activeLaunchCapability: row.launchLinks.length > 0, currentCommandId: null, invitationOutcome: null, launchOperation: null, environment: { value: row.environmentStatus, source: row.environmentStatus ? "cloudshare_v4_sales_participant_roster" : row.cloudShareRosterEnvironmentReference ? "not_observed" : "not_assigned", ...(row.environmentObservedAt ? { observedAt: row.environmentObservedAt.toISOString() } : {}) }, environmentAttention: row.environmentAttentionReason ? { reason: "Participant Environment requires support review.", source: "Certalis correlation" } : null })) };
    return page;
  } };
}
