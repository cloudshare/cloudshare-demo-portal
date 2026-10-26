import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantSearchRepository } from "@/api/sales-session-participant-search";
import { isProjectableSalesParticipantRosterEnvironment, projectSalesParticipantV4Environment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "@/domain/sales-participant-environment";
import { projectSalesSessionStatus, type CloudShareSalesExperienceStatus, type SalesSessionStatusInput } from "@/domain/sales-session-status";

export function createPrismaSalesSessionParticipantSearch(prisma: PrismaClient, now: () => Date = () => new Date()): SalesParticipantSearchRepository {
  return { async search(customerId, term, offset, limit) {
    const contact = { archivedAt: null, OR: [{ firstName: { contains: term } }, { lastName: { contains: term } }, { email: { contains: term } }] };
    // Defend the read boundary as well as the database constraint: historic or
    // malformed rows must not join a Customer's participant to another
    // Customer's Sales Enablement Session.
    const where = { customerId, session: { customerId }, contact };
    const [total, participants] = await Promise.all([prisma.salesSessionParticipant.count({ where }), prisma.salesSessionParticipant.findMany({ where, include: { contact: { select: { firstName: true, lastName: true, email: true } }, session: { select: { id: true, sessionName: true, opportunityId: true, operationalStatus: true, attentionReason: true, start: true, end: true, timeZone: true, experienceStatus: true, experienceStatusObservedAt: true, experienceStatusSource: true } } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: offset, take: limit })]);
    const projectionNow = now();
    return { total, rows: participants.map((participant) => { const environment = participant.v4EnvironmentStatus && participant.v4EnvironmentObservedAt && (!participant.environmentObservedAt || participant.v4EnvironmentObservedAt >= participant.environmentObservedAt) ? projectSalesParticipantV4Environment(participant.v4EnvironmentStatus, participant.v4EnvironmentObservedAt) : isProjectableSalesParticipantRosterEnvironment(participant.environmentStatus) && participant.environmentObservedAt ? projectSalesParticipantRosterEnvironment(participant.environmentStatus, participant.environmentObservedAt) : participant.environmentStatusCode !== null && participant.environmentStatusCode !== undefined ? projectSalesParticipantEnvironment(participant.environmentStatusCode, participant.environmentObservedAt ?? undefined) : { dimension: "cloudshare_environment" as const, value: null, source: participant.cloudShareRosterEnvironmentReference ? "not_observed" as const : "not_assigned" as const }; const status = projectSalesSessionStatus({ ...participant.session, operationalStatus: isOperationalStatus(participant.session.operationalStatus) ? participant.session.operationalStatus : undefined, experienceStatus: isExperienceStatus(participant.session.experienceStatus) ? participant.session.experienceStatus : null, experienceStatusSource: participant.session.experienceStatusSource }, projectionNow); return { id: participant.id, sessionId: participant.session.id, sessionName: participant.session.sessionName || "Sales Enablement Session", opportunityId: participant.session.opportunityId, firstName: participant.contact.firstName, lastName: participant.contact.lastName, email: participant.contact.email, operation: status.operation, experience: status.experience, environment }; }) };
  } };
}

function isOperationalStatus(value: string): value is NonNullable<SalesSessionStatusInput["operationalStatus"]> { return value === "provisioning" || value === "active" || value === "needs_attention"; }
function isExperienceStatus(value: string | null): value is CloudShareSalesExperienceStatus { return value === "notStarted" || value === "inProgress" || value === "ended"; }
