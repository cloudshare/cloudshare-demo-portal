import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantWorkspacePage, SalesParticipantWorkspaceReader } from "@/domain/sales-participant-workspace";
export function createPrismaSalesParticipantWorkspaceReader(prisma: PrismaClient): SalesParticipantWorkspaceReader {
  return { async readPage(input) {
    const session = await prisma.salesDemoSession.findFirst({ where: { id: input.sessionId, customerId: input.customerId }, select: { id: true, end: true, sendInvitations: true } });
    if (!session) return null;
    const where = { customerId: input.customerId, salesDemoSessionId: input.sessionId, contact: { archivedAt: null, opportunity: { archivedAt: null }, ...(input.query ? { OR: [{ firstName: { contains: input.query, mode: "insensitive" as const } }, { lastName: { contains: input.query, mode: "insensitive" as const } }, { email: { contains: input.query, mode: "insensitive" as const } }] } : {}) } };
    const [total, rows] = await Promise.all([prisma.salesSessionParticipant.count({ where }), prisma.salesSessionParticipant.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: input.offset, take: input.limit, include: { contact: { select: { firstName: true, lastName: true, email: true } }, launchLinks: { where: { revokedAt: null }, select: { id: true }, take: 1 } } })]);
    const page: SalesParticipantWorkspacePage = { total, offset: input.offset, limit: input.limit, hasMore: input.offset + rows.length < total, participants: rows.map((row) => ({ id: row.id, participantRevision: row.updatedAt.toISOString(), name: `${row.contact.firstName} ${row.contact.lastName}`.trim(), email: row.contact.email, invitationStatus: row.invitationStatus === "sent" ? "sent" : "notSent", participationStatus: row.participationStatus, sessionEndsAt: session.end, nativeInvitationsEnabled: session.sendInvitations === "salesProsAndParticipants", providerCorrelation: Boolean(row.cloudShareParticipantId), activeLaunchCapability: row.launchLinks.length > 0 })) };
    return page;
  } };
}
