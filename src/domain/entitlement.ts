import type { ExamAttempt } from "./exam-attempt";

/**
 * `Entitlement` is the server-side decision that a candidate may access a lab for
 * a specific ExamAttempt. It is ALWAYS recomputed from persisted state here —
 * never trusted from the client — so a candidate cannot grant themselves a lab
 * by tampering with a request.
 */
export interface Entitlement {
  readonly examAttemptId: string;
  readonly candidateId: string;
  readonly allowed: boolean;
  /** Why entitlement was denied, for logging/audit. Absent when allowed. */
  readonly reason?: string;
}

/**
 * Compute entitlement from the persisted ExamAttempt. A null attempt (unknown id)
 * is never entitled; a booked attempt is. Status transitions in later slices may
 * tighten this (e.g. deny once scored).
 */
export function computeEntitlement(
  examAttemptId: string,
  attempt: ExamAttempt | null,
): Entitlement {
  if (!attempt) {
    return {
      examAttemptId,
      candidateId: "",
      allowed: false,
      reason: "exam attempt not found",
    };
  }

  const allowed = attempt.status === "booked";
  return {
    examAttemptId: attempt.id,
    candidateId: attempt.candidateId,
    allowed,
    reason: allowed ? undefined : `exam attempt status "${attempt.status}" is not launchable`,
  };
}
