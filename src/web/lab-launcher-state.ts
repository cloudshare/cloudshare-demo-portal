import type { CandidateLabStatus } from "./lab-launcher-client";

export type LaunchState =
  | "idle"
  | "launching"
  | "open"
  | "suspending"
  | "suspended"
  | "completed"
  | "error";

export type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";

export function updateCandidateLabStatus(
  current: CandidateLabStatus | null,
  next: CandidateLabStatus,
): CandidateLabStatus {
  if (
    current &&
    current.examAttemptId === next.examAttemptId &&
    current.examTitle === next.examTitle &&
    current.timeLimitMinutes === next.timeLimitMinutes &&
    current.status === next.status &&
    current.scheduledFor === next.scheduledFor
  ) {
    return current;
  }

  return next;
}

export function updateCandidateLabStatusAttemptState(
  current: CandidateLabStatus | null,
  status: AttemptStatus,
): CandidateLabStatus | null {
  if (!current || current.status === status) {
    return current;
  }

  return {
    ...current,
    status,
  };
}

export function getLauncherSyncTarget(
  attemptStatus: AttemptStatus,
): { state: LaunchState; message: string } | null {
  if (attemptStatus === "completed") {
    return {
      state: "completed",
      message: "Examination complete.",
    };
  }

  if (attemptStatus === "suspended") {
    return {
      state: "suspended",
      message: "Lab suspended.",
    };
  }

  return null;
}
