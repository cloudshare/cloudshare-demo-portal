import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantSearchRepository } from "@/api/sales-session-participant-search";
import { projectSalesParticipantEnvironment } from "@/domain/sales-participant-environment";

export function createPrismaSalesSessionParticipantSearch(prisma: PrismaClient): SalesParticipantSearchRepository {
  return { async search(customerId, term, offset, limit) {
    const contacts = await prisma.opportunityContact.findMany({ where: { customerId, archivedAt: null, OR: [{ firstName: { contains: term } }, { lastName: { contains: term } }, { email: { contains: term } }] }, select: { id: true, firstName: true, lastName: true, email: true }, take: 500 });
    if (!contacts.length) return { rows: [], total: 0 };
    const byId = new Map(contacts.map((contact) => [contact.id, contact]));
    const where = { customerId, opportunityContactId: { in: contacts.map((contact) => contact.id) } };
    const [total, participants] = await Promise.all([prisma.salesSessionParticipant.count({ where }), prisma.salesSessionParticipant.findMany({ where, include: { session: { select: { id: true, sessionName: true, opportunityId: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: offset, take: limit })]);
    return { total, rows: participants.map((participant) => { const contact = byId.get(participant.opportunityContactId)!; const environment = participant.environmentStatusCode !== null && participant.environmentStatusCode !== undefined ? projectSalesParticipantEnvironment(participant.environmentStatusCode, participant.environmentObservedAt ?? undefined) : { dimension: "cloudshare_environment" as const, value: null, source: participant.cloudShareEnvironmentId ? "not_observed" as const : "not_assigned" as const }; return { id: participant.id, sessionId: participant.session.id, sessionName: participant.session.sessionName || "Sales Enablement Session", opportunityId: participant.session.opportunityId, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, environment }; }) };
  } };
}
