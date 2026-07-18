import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantLaunchLinkRepository } from "@/domain/sales-participant-launch-link";
export function createPrismaSalesParticipantLaunchLinkRepository(prisma: PrismaClient): SalesParticipantLaunchLinkRepository {
  return {
    async create(link) { await prisma.salesParticipantLaunchLink.create({ data: link }); },
    async revokeActive(customerId, salesDemoSessionId, participantId, at) { await prisma.salesParticipantLaunchLink.updateMany({ where: { customerId, salesDemoSessionId, salesSessionParticipantId: participantId, revokedAt: null }, data: { revokedAt: at } }); },
    async findByTokenHash(tokenHash) { return prisma.salesParticipantLaunchLink.findUnique({ where: { tokenHash } }); },
  };
}
