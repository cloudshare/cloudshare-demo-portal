import type { PrismaClient } from "@prisma/client";
import type { EnvironmentRecord, EnvironmentRepository } from "@/domain/environment";

export function createPrismaEnvironmentRepository(prisma: PrismaClient): EnvironmentRepository {
  return {
    async findByExternalId(environmentExternalId: string): Promise<EnvironmentRecord | null> {
      const row = await prisma.environmentRecord.findUnique({
        where: { environmentExternalId },
      });
      return row
        ? {
            environmentExternalId: row.environmentExternalId,
            status: row.status as EnvironmentRecord["status"],
            observedAt: row.observedAt,
          }
        : null;
    },

    async save(record: EnvironmentRecord): Promise<void> {
      const existing = await prisma.environmentRecord.findUnique({
        where: { environmentExternalId: record.environmentExternalId },
      });
      if (existing && existing.observedAt.getTime() >= record.observedAt.getTime()) {
        return;
      }
      await prisma.environmentRecord.upsert({
        where: { environmentExternalId: record.environmentExternalId },
        update: {
          status: record.status,
          observedAt: record.observedAt,
        },
        create: {
          environmentExternalId: record.environmentExternalId,
          status: record.status,
          observedAt: record.observedAt,
        },
      });
    },
  };
}
