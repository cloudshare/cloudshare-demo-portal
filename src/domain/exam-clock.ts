import type { ExamTimer } from "./timer-sync";

export type ExamClockStatus = "running" | "paused";

export interface ExamClockState {
  readonly examAttemptId: string;
  readonly status: ExamClockStatus;
  readonly elapsedAtPauseMs: number;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
}

export interface ExamClockRepository {
  findByExamAttemptId(examAttemptId: string): Promise<ExamClockState | null>;
  save(state: ExamClockState): Promise<void>;
}

export interface ExamClock extends ExamTimer {
  getTimerState(examAttemptId: string): Promise<ExamClockState | null>;
}

export function createExamClock(deps: {
  readonly clocks: ExamClockRepository;
  readonly now?: () => Date;
}): ExamClock {
  const now = deps.now ?? (() => new Date());

  return {
    async getTimerState(examAttemptId: string): Promise<ExamClockState | null> {
      return deps.clocks.findByExamAttemptId(examAttemptId);
    },

    async pauseTimer(examAttemptId: string): Promise<void> {
      const state = await deps.clocks.findByExamAttemptId(examAttemptId);
      const pausedAt = now();
      const elapsedAtPauseMs =
        state?.status === "running" && state.startedAt
          ? state.elapsedAtPauseMs + Math.max(0, pausedAt.getTime() - state.startedAt.getTime())
          : state?.elapsedAtPauseMs ?? 0;

      await deps.clocks.save({
        examAttemptId,
        status: "paused",
        elapsedAtPauseMs,
        startedAt: null,
        updatedAt: pausedAt,
      });
    },

    async resumeTimer(examAttemptId: string): Promise<void> {
      const state = await deps.clocks.findByExamAttemptId(examAttemptId);
      const resumedAt = now();
      const elapsedAtPauseMs =
        state?.status === "running" && state.startedAt
          ? state.elapsedAtPauseMs + Math.max(0, resumedAt.getTime() - state.startedAt.getTime())
          : state?.elapsedAtPauseMs ?? 0;

      await deps.clocks.save({
        examAttemptId,
        status: "running",
        elapsedAtPauseMs,
        startedAt: resumedAt,
        updatedAt: resumedAt,
      });
    },
  };
}

export function createInMemoryExamClockRepository(): ExamClockRepository & {
  reset(): void;
} {
  const byExamAttemptId = new Map<string, ExamClockState>();

  return {
    async findByExamAttemptId(examAttemptId: string): Promise<ExamClockState | null> {
      return byExamAttemptId.get(examAttemptId) ?? null;
    },
    async save(state: ExamClockState): Promise<void> {
      byExamAttemptId.set(state.examAttemptId, state);
    },
    reset(): void {
      byExamAttemptId.clear();
    },
  };
}
