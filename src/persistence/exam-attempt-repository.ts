import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";

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
      byId.set(attempt.id, attempt);
    },
    async findById(id: string): Promise<ExamAttempt | null> {
      return byId.get(id) ?? null;
    },
    async listByCandidate(candidateId: string): Promise<ExamAttempt[]> {
      return [...byId.values()].filter((a) => a.candidateId === candidateId);
    },
    reset(): void {
      byId.clear();
    },
  };
}
