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
export type RecoveryAction = "enter" | "resume" | "reopen";

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

export function getLauncherRecoveryAction(
  attemptStatus: AttemptStatus,
): { action: RecoveryAction; label: string } | null {
  switch (attemptStatus) {
    case "ready":
      return { action: "enter", label: "Enter exam" };
    case "in_progress":
      return { action: "reopen", label: "Open exam window" };
    case "suspended":
      return { action: "resume", label: "Resume exam" };
    default:
      return null;
  }
}
