import type { EnvironmentRecord, EnvironmentRepository } from "@/domain/environment";

/**
 * In-memory {@link EnvironmentRepository} for the demo (Prisma-swappable behind the
 * port), keyed by `environmentExternalId` so a reconciled environment can be
 * correlated back to the LabLaunch that created it.
 */
export function createInMemoryEnvironmentRepository(): EnvironmentRepository & {
  reset(): void;
} {
  const byExternalId = new Map<string, EnvironmentRecord>();

  return {
    async findByExternalId(environmentExternalId: string): Promise<EnvironmentRecord | null> {
      return byExternalId.get(environmentExternalId) ?? null;
    },
    async save(record: EnvironmentRecord): Promise<void> {
      byExternalId.set(record.environmentExternalId, record);
    },
    reset(): void {
      byExternalId.clear();
    },
  };
}
