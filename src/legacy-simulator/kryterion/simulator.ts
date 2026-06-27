import { randomUUID } from "node:crypto";
import { signExamToken } from "@/auth/exam-token";
import type { ExamTimer } from "@/domain/timer-sync";

/**
 * Retired Kryterion simulator retained only for the legacy `/demo` compatibility
 * surface. It mints short-lived signed exam tokens and implements the timer port
 * used by that legacy flow.
 */

export interface MintExamTokenInput {
  readonly examAttemptId: string;
  readonly candidateId: string;
}

export interface KryterionTimerState {
  readonly status: "running" | "paused";
  /** Epoch ms when the timer last started or resumed. */
  readonly startedAt: number;
  /** Elapsed ms banked at the last pause (0 if never paused). */
  readonly elapsedAtPause: number;
}

export interface KryterionSimulator extends ExamTimer {
  /** Mint a signed, single-use token admitting the candidate to one ExamAttempt. */
  mintExamToken(input: MintExamTokenInput): string;
  /** Get the current timer state, or null if the timer has never been touched. */
  getTimerState(examAttemptId: string): KryterionTimerState | null;
  /** Clear all timer state for a clean demo reset. */
  reset(): void;
}

export interface KryterionSimulatorOptions {
  /** HMAC secret shared with the auth layer. */
  readonly secret: string;
  /** Token lifetime in seconds (short — exam tokens are redeemed immediately). */
  readonly ttlSeconds: number;
  /** Current time, epoch ms. Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Single-use token id generator. Injectable for tests. Defaults to a random UUID. */
  readonly newJti?: () => string;
}

export function createKryterionSimulator(
  opts: KryterionSimulatorOptions,
): KryterionSimulator {
  const now = opts.now ?? Date.now;
  const newJti = opts.newJti ?? (() => randomUUID());

  const timers = new Map<string, KryterionTimerState>();

  return {
    mintExamToken({ examAttemptId, candidateId }: MintExamTokenInput): string {
      const iat = Math.floor(now() / 1000);
      return signExamToken(
        {
          jti: newJti(),
          examAttemptId,
          candidateId,
          iat,
          exp: iat + opts.ttlSeconds,
        },
        opts.secret,
      );
    },

    async pauseTimer(examAttemptId: string): Promise<void> {
      const existing = timers.get(examAttemptId);
      const elapsed = existing
        ? existing.status === "running"
          ? existing.elapsedAtPause + (now() - existing.startedAt)
          : existing.elapsedAtPause
        : 0;
      timers.set(examAttemptId, {
        status: "paused",
        startedAt: existing?.startedAt ?? now(),
        elapsedAtPause: elapsed,
      });
    },

    async resumeTimer(examAttemptId: string): Promise<void> {
      const existing = timers.get(examAttemptId);
      // If already running (e.g. idempotent retry), bank elapsed time first so
      // no ticks are lost before resetting startedAt.
      const banked =
        existing?.status === "running"
          ? existing.elapsedAtPause + (now() - existing.startedAt)
          : existing?.elapsedAtPause ?? 0;
      timers.set(examAttemptId, {
        status: "running",
        startedAt: now(),
        elapsedAtPause: banked,
      });
    },

    getTimerState(examAttemptId: string): KryterionTimerState | null {
      return timers.get(examAttemptId) ?? null;
    },

    reset(): void {
      timers.clear();
    },
  };
}
