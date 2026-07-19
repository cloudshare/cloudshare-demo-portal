import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantSearchRepository } from "@/api/sales-session-participant-search";
import { projectSalesParticipantEnvironment } from "@/domain/sales-participant-environment";

export function createPrismaSalesSessionParticipantSearch(prisma: PrismaClient): SalesParticipantSearchRepository {
  return { async search(customerId, term, offset, limit) {
    const contact = { archivedAt: null, OR: [{ firstName: { contains: term } }, { lastName: { contains: term } }, { email: { contains: term } }] };
    const where = { customerId, contact };
    const [total, participants] = await Promise.all([prisma.salesSessionParticipant.count({ where }), prisma.salesSessionParticipant.findMany({ where, include: { contact: { select: { firstName: true, lastName: true, email: true } }, session: { select: { id: true, sessionName: true, opportunityId: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: offset, take: limit })]);
    return { total, rows: participants.map((participant) => { const environment = participant.environmentStatusCode !== null && participant.environmentStatusCode !== undefined ? projectSalesParticipantEnvironment(participant.environmentStatusCode, participant.environmentObservedAt ?? undefined) : { dimension: "cloudshare_environment" as const, value: null, source: participant.cloudShareEnvironmentId ? "not_observed" as const : "not_assigned" as const }; return { id: participant.id, sessionId: participant.session.id, sessionName: participant.session.sessionName || "Sales Enablement Session", opportunityId: participant.session.opportunityId, firstName: participant.contact.firstName, lastName: participant.contact.lastName, email: participant.contact.email, environment }; }) };
  } };
}
