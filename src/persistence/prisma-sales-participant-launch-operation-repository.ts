import type { PrismaClient } from "@prisma/client";
import type { SalesParticipantLaunchOperationRepository, SalesParticipantLaunchOperation } from "@/domain/sales-participant-launch-operation";

export function createPrismaSalesParticipantLaunchOperationRepository(prisma: PrismaClient): SalesParticipantLaunchOperationRepository {
  return {
    async record(operation) {
      await prisma.salesParticipantLaunchOperation.create({ data: operation });
    },
    async latestForParticipants(input) {
      if (input.participantIds.length === 0) return [];
      const rows = await prisma.salesParticipantLaunchOperation.findMany({
        where: { customerId: input.customerId, salesDemoSessionId: input.sessionId, salesSessionParticipantId: { in: [...input.participantIds] } },
        orderBy: [{ occurredAt: "desc" }, { revision: "desc" }, { id: "desc" }],
        distinct: ["salesSessionParticipantId"],
        select: { id: true, customerId: true, salesDemoSessionId: true, salesSessionParticipantId: true, correlationId: true, operation: true, outcome: true, safeReason: true, occurredAt: true, revision: true },
      });
      return rows as SalesParticipantLaunchOperation[];
    },
  };
}
