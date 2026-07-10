import type { PrismaClient } from "@prisma/client";
import type { CohortMonitoringObservationRepository } from "@/domain/cohort-monitoring-observation";

export function createPrismaCohortMonitoringObservationRepository(
  prisma: PrismaClient,
): CohortMonitoringObservationRepository {
  return {
    async record(input) {
      const existing = await prisma.cohortMonitoringObservation.findUnique({
        where: {
          customerId_cohortSessionId_rowKey: {
            customerId: input.customerId,
            cohortSessionId: input.cohortSessionId,
            rowKey: input.rowKey,
          },
        },
      });
      const consecutiveReads = existing?.signature === input.signature ? existing.consecutiveReads + 1 : 1;
      return prisma.cohortMonitoringObservation.upsert({
        where: {
          customerId_cohortSessionId_rowKey: {
            customerId: input.customerId,
            cohortSessionId: input.cohortSessionId,
            rowKey: input.rowKey,
          },
        },
        create: { ...input, consecutiveReads },
        update: { signature: input.signature, consecutiveReads, observedAt: input.observedAt },
      });
    },
  };
}
