import { createInMemoryExamClockRepository, transitionExamClock, type ExamClockRepository } from "@/domain/exam-clock";
import {
  DuplicateCohortExamAttemptError,
  SameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
  type ExamAttemptRepository,
  type ExamAttemptRuntimeCommand,
} from "@/domain/exam-attempt";

/**
 * In-memory {@link ExamAttemptRepository} for the demo. It persists for the life
 * of the running server (so attempts survive page reloads). A Prisma-backed
 * implementation slots in behind the same interface for a durable deployment.
 */
export function createInMemoryExamAttemptRepository(clocks: ExamClockRepository = createInMemoryExamClockRepository()): ExamAttemptRepository & {
  reset(): void;
} {
  const byId = new Map<string, ExamAttempt>();
  const commands = new Map<string, ExamAttemptRuntimeCommand>();

  return {
    async readRuntimeCommand(customerId, examAttemptId) {
      const command = commands.get(examAttemptId);
      return command?.customerId === customerId ? command : null;
    },
    async claimRuntimeCommand(command, expectedStatus) {
      const attempt = byId.get(command.examAttemptId);
      if (attempt?.customerId !== command.customerId || attempt.status !== expectedStatus || commands.has(command.examAttemptId)) return false;
      commands.set(command.examAttemptId, command);
      return true;
    },
    async settleRuntimeCommand(command, at) {
      const clock = await clocks.findByExamAttemptId(command.examAttemptId);
      const current = commands.get(command.examAttemptId);
      const attempt = byId.get(command.examAttemptId);
      if (!current || current.commandId !== command.commandId || current.customerId !== command.customerId || current.action !== command.action || current.environmentId !== command.environmentId || attempt?.customerId !== command.customerId || !["in_progress", "suspended"].includes(attempt.status)) return false;
      await clocks.save(transitionExamClock(clock, command.examAttemptId, command.action, at));
      byId.set(attempt.id, { ...attempt, status: command.action === "suspend" ? "suspended" : "in_progress" });
      commands.delete(command.examAttemptId);
      return true;
    },
    async releaseRuntimeCommand(command) {
      if (commands.get(command.examAttemptId)?.commandId === command.commandId && commands.get(command.examAttemptId)?.customerId === command.customerId) commands.delete(command.examAttemptId);
    },
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
      commands.delete(id);
    },
    reset(): void {
      byId.clear();
      commands.clear();
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
