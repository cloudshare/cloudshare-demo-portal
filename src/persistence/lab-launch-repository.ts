import type { LabLaunch, LabLaunchRepository } from "@/domain/lab-launch";

/**
 * In-memory {@link LabLaunchRepository} for the demo (Prisma-swappable behind the
 * port). Indexed by id and by examAttemptId so the launch — and its persisted
 * `environmentExternalId` — can be correlated back to an attempt.
 */
export function createInMemoryLabLaunchRepository(): LabLaunchRepository & {
  reset(): void;
} {
  const byId = new Map<string, LabLaunch>();

  return {
    async save(launch: LabLaunch): Promise<void> {
      byId.set(launch.id, launch);
    },
    async findById(id: string): Promise<LabLaunch | null> {
      return byId.get(id) ?? null;
    },
    async findByExamAttemptId(examAttemptId: string): Promise<LabLaunch | null> {
      return [...byId.values()].find((l) => l.examAttemptId === examAttemptId) ?? null;
    },
    async findByCustomerIdAndEnvironmentExternalId(
      _customerId: string,
      environmentExternalId: string,
    ): Promise<LabLaunch | null> {
      return [...byId.values()].find((l) => l.environmentExternalId === environmentExternalId) ?? null;
    },
    async findPendingEnvironmentCorrelation({ participantEmail }: {
      customerId: string;
      participantEmail: string;
      environmentName: string | null;
    }): Promise<LabLaunch | null> {
      return [...byId.values()]
        .filter((launch) =>
          launch.participantEmail?.trim().toLowerCase() === participantEmail.trim().toLowerCase() &&
          !launch.environmentExternalId &&
          !launch.environmentId,
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
    },
    reset(): void {
      byId.clear();
    },
  };
}
