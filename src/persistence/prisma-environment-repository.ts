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
      await prisma.$executeRaw`
        INSERT INTO "EnvironmentRecord" ("environmentExternalId", "status", "observedAt")
        VALUES (${record.environmentExternalId}, ${record.status}, ${record.observedAt})
        ON CONFLICT("environmentExternalId") DO UPDATE SET
          "status" = excluded."status",
          "observedAt" = excluded."observedAt"
        WHERE "EnvironmentRecord"."observedAt" < excluded."observedAt"
      `;
    },
  };
}
