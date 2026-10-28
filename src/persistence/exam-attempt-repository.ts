import { createInMemoryExamClockRepository, transitionExamClock, type ExamClockRepository } from "@/domain/exam-clock";
import {
  DuplicateCohortExamAttemptError,
  SameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
  type ExamAttemptRepository,
  type PendingExamAttemptRuntimeCommand,
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
  const commands = new Map<string, PendingExamAttemptRuntimeCommand>();
  let mutations: Promise<void> = Promise.resolve();
  function mutate<T>(work: () => Promise<T> | T): Promise<T> {
    const result = mutations.then(work);
    mutations = result.then(() => undefined, () => undefined);
    return result;
  }
  function saveRecord(attempt: ExamAttempt): void {
    if (attempt.cohortSessionId && [...byId.values()].some(existing => existing.id !== attempt.id && existing.candidateId === attempt.candidateId && existing.cohortSessionId === attempt.cohortSessionId)) {
      throw new DuplicateCohortExamAttemptError(attempt.candidateId, attempt.cohortSessionId);
    }
    byId.set(attempt.id, attempt);
  }

  return {
    async readRuntimeCommand(customerId, examAttemptId) {
      await mutations;
      const command = commands.get(examAttemptId);
      return command?.customerId === customerId ? command : null;
    },
    claimRuntimeCommand(command, expectedStatus) {
      return mutate(() => {
        const attempt = byId.get(command.examAttemptId);
        if (attempt?.customerId !== command.customerId || attempt.status !== expectedStatus || commands.has(command.examAttemptId)) return false;
        commands.set(command.examAttemptId, { ...command, phase: "dispatching" });
        return true;
      });
    },
    finishRuntimeCommandDispatch(command) {
      return mutate(() => {
        const current = commands.get(command.examAttemptId);
        if (!current || current.phase !== "dispatching" || current.commandId !== command.commandId || current.customerId !== command.customerId || current.action !== command.action || current.environmentId !== command.environmentId) return false;
        commands.set(command.examAttemptId, { ...current, phase: "observing" });
        return true;
      });
    },
    settleRuntimeCommand(command, at) {
      return mutate(async () => {
        const clock = await clocks.findByExamAttemptId(command.examAttemptId);
        const current = commands.get(command.examAttemptId);
        const attempt = byId.get(command.examAttemptId);
        if (!current || current.phase !== "observing" || current.commandId !== command.commandId || current.customerId !== command.customerId || current.action !== command.action || current.environmentId !== command.environmentId || attempt?.customerId !== command.customerId || !["in_progress", "suspended"].includes(attempt.status)) return false;
        await clocks.save(transitionExamClock(clock, command.examAttemptId, command.action, at));
        byId.set(attempt.id, { ...attempt, status: command.action === "suspend" ? "suspended" : "in_progress" });
        commands.delete(command.examAttemptId);
        return true;
      });
    },
    releaseRuntimeCommand(command) {
      return mutate(() => {
        if (commands.get(command.examAttemptId)?.phase === "dispatching" && commands.get(command.examAttemptId)?.commandId === command.commandId && commands.get(command.examAttemptId)?.customerId === command.customerId) commands.delete(command.examAttemptId);
      });
    },
    save(attempt) {
      return mutate(() => saveRecord(attempt));
    },
    saveWithSameExamAvailabilityGuard(attempt, options) {
      return mutate(() => {
        const overlap = findSameExamAvailabilityOverlap({ existingAttempts: [...byId.values()], attempt, availabilityWindowMinutes: options.availabilityWindowMinutes });
        if (overlap) throw new SameExamAttemptAvailabilityConflictError(attempt.candidateId, attempt.examId, overlap.conflictingAttemptId, overlap.nextAvailableAt);
        saveRecord(attempt);
      });
    },
    async findById(id) {
      await mutations;
      return byId.get(id) ?? null;
    },
    async listByCandidate(candidateId) {
      await mutations;
      return [...byId.values()].filter(a => a.candidateId === candidateId);
    },
    delete(id) {
      return mutate(() => { byId.delete(id); commands.delete(id); });
    },
    reset() { byId.clear(); commands.clear(); },
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
