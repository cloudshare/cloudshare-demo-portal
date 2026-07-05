import {
  DuplicateCohortExamAttemptError,
  SameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
  type ExamAttemptRepository,
} from "@/domain/exam-attempt";

/**
 * In-memory {@link ExamAttemptRepository} for the demo. It persists for the life
 * of the running server (so attempts survive page reloads). A Prisma-backed
 * implementation slots in behind the same interface for a durable deployment.
 */
export function createInMemoryExamAttemptRepository(): ExamAttemptRepository & {
  reset(): void;
} {
  const byId = new Map<string, ExamAttempt>();

  return {
    async save(attempt: ExamAttempt): Promise<void> {
      if (
        attempt.cohortSessionId &&
        [...byId.values()].some(
          (existing) =>
            existing.id !== attempt.id &&
            existing.candidateId === attempt.candidateId &&
            existing.cohortSessionId === attempt.cohortSessionId,
        )
      ) {
        throw new DuplicateCohortExamAttemptError(
          attempt.candidateId,
          attempt.cohortSessionId,
        );
      }
      byId.set(attempt.id, attempt);
    },
    async saveWithSameExamAvailabilityGuard(
      attempt: ExamAttempt,
      options: { readonly availabilityWindowMinutes: number },
    ): Promise<void> {
      const overlap = findSameExamAvailabilityOverlap({
        existingAttempts: [...byId.values()],
        attempt,
        availabilityWindowMinutes: options.availabilityWindowMinutes,
      });
      if (overlap) {
        throw new SameExamAttemptAvailabilityConflictError(
          attempt.candidateId,
          attempt.examId,
          overlap.conflictingAttemptId,
          overlap.nextAvailableAt,
        );
      }
      await this.save(attempt);
    },
    async findById(id: string): Promise<ExamAttempt | null> {
      return byId.get(id) ?? null;
    },
    async listByCandidate(candidateId: string): Promise<ExamAttempt[]> {
      return [...byId.values()].filter((a) => a.candidateId === candidateId);
    },
    async delete(id: string): Promise<void> {
      byId.delete(id);
    },
    reset(): void {
      byId.clear();
    },
  };
}

function findSameExamAvailabilityOverlap(input: {
  readonly existingAttempts: readonly ExamAttempt[];
  readonly attempt: ExamAttempt;
  readonly availabilityWindowMinutes: number;
}): { readonly conflictingAttemptId: string; readonly nextAvailableAt: Date } | null {
  if (!input.attempt.scheduledFor) {
    return null;
  }
  const requestedAtMs = input.attempt.scheduledFor.getTime();
  const windowMs = input.availabilityWindowMinutes * 60_000;
  const requestedEndMs = requestedAtMs + windowMs;

  for (const existing of input.existingAttempts) {
    if (
      existing.id === input.attempt.id ||
      existing.candidateId !== input.attempt.candidateId ||
      existing.examId !== input.attempt.examId ||
      existing.status === "completed" ||
      existing.status === "expired" ||
      !existing.scheduledFor
    ) {
      continue;
    }

    const windowStartMs = existing.scheduledFor.getTime();
    if (!Number.isFinite(windowStartMs)) {
      continue;
    }
    const windowEndMs = windowStartMs + windowMs;
    if (requestedAtMs < windowEndMs && requestedEndMs > windowStartMs) {
      return {
        conflictingAttemptId: existing.id,
        nextAvailableAt: new Date(windowEndMs),
      };
    }
  }

  return null;
}
