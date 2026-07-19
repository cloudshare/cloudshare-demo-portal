import type { PrismaClient } from "@prisma/client";
import type { SalesSessionParticipant, SalesSessionParticipantRepository } from "@/domain/sales-session-participant";

export function createPrismaSalesSessionParticipantRepository(prisma: PrismaClient): SalesSessionParticipantRepository {
  return {
    async save(value) {
      const { cloudShareEnvironmentId: legacyReference, ...data } = value;
      const rosterReference = value.cloudShareRosterEnvironmentReference ?? legacyReference ?? null;
      await prisma.salesSessionParticipant.upsert({
        where: { customerId_salesDemoSessionId_opportunityContactId: { customerId: value.customerId, salesDemoSessionId: value.salesDemoSessionId, opportunityContactId: value.opportunityContactId } },
        create: { ...data, cloudShareRosterEnvironmentReference: rosterReference, lastInvitedAt: value.lastInvitedAt ?? null },
        update: { cloudShareParticipantId: value.cloudShareParticipantId, invitationStatus: value.invitationStatus, lastInvitedAt: value.lastInvitedAt ?? null, invitedBy: value.invitedBy, participationStatus: value.participationStatus, firstJoined: value.firstJoined, cloudShareRosterEnvironmentReference: rosterReference, environmentStatus: value.environmentStatus, lastReconciledAt: value.lastReconciledAt, updatedAt: value.updatedAt },
      });
    },
    async list(customerId, salesDemoSessionId) {
      return (await prisma.salesSessionParticipant.findMany({ where: { customerId, salesDemoSessionId }, orderBy: { createdAt: "asc" } })).map((row) => ({ ...row, cloudShareEnvironmentId: row.cloudShareRosterEnvironmentReference })) as SalesSessionParticipant[];
    },
    async recordEnvironmentObservation(customerId, participantId, observation) {
      const updated = await prisma.salesSessionParticipant.updateMany({ where: { customerId, id: participantId }, data: { environmentStatusCode: observation.statusCode, environmentObservedAt: observation.observedAt, environmentAttentionReason: observation.attentionReason ?? null, environmentAttentionSource: observation.attentionSource ?? null } });
      if (updated.count !== 1) throw new Error("Sales Session Participant was not found for this Customer");
    },
  };
}
