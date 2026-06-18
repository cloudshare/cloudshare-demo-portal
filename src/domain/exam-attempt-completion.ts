import type { ExamAttempt, ExamAttemptRepository } from "./exam-attempt";
import type { ExamRepository } from "./exam-catalog";
import type { ExamClock } from "./exam-clock";

const COMPLETABLE_STATUSES = new Set<ExamAttempt["status"]>(["ready", "in_progress", "suspended"]);

export interface ReconcileExamAttemptCompletionDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams: ExamRepository;
  readonly clocks?: ExamClock;
}

export interface ReconcileExamAttemptCompletionResult {
  readonly examAttemptId: string;
  readonly status: ExamAttempt["status"];
  readonly changed: boolean;
  readonly elapsedMs: number;
}

export async function reconcileExamAttemptCompletion(
  deps: ReconcileExamAttemptCompletionDeps,
  input: { readonly examAttemptId: string },
): Promise<ReconcileExamAttemptCompletionResult | null> {
  const attempt = await deps.attempts.findById(input.examAttemptId);
  if (!attempt) {
    return null;
  }

  const elapsedMs = deps.clocks ? await deps.clocks.getElapsedMs(input.examAttemptId) : 0;
  const exam = await deps.exams.findById(attempt.examId);
  if (!exam || !deps.clocks) {
    return {
      examAttemptId: attempt.id,
      status: attempt.status,
      changed: false,
      elapsedMs,
    };
  }

  const limitMs = exam.timeLimitMinutes * 60 * 1000;
  if (elapsedMs < limitMs) {
    return {
      examAttemptId: attempt.id,
      status: attempt.status,
      changed: false,
      elapsedMs,
    };
  }

  const existingClockState = await deps.clocks.getTimerState(attempt.id);
  const clockNeedsSettlement = Boolean(
    existingClockState &&
      (existingClockState.status !== "paused" ||
        existingClockState.elapsedAtPauseMs !== limitMs ||
        existingClockState.startedAt !== null),
  );
  await deps.clocks.settleCompletion(attempt.id, limitMs);
  if (!COMPLETABLE_STATUSES.has(attempt.status) && attempt.status !== "completed") {
    return {
      examAttemptId: attempt.id,
      status: attempt.status,
      changed: clockNeedsSettlement,
      elapsedMs: limitMs,
    };
  }

  if (attempt.status !== "completed") {
    await deps.attempts.save({
      ...attempt,
      status: "completed",
    });
    return {
      examAttemptId: attempt.id,
      status: "completed",
      changed: true,
      elapsedMs: limitMs,
    };
  }

  return {
    examAttemptId: attempt.id,
    status: "completed",
    changed: clockNeedsSettlement,
    elapsedMs: limitMs,
  };
}
