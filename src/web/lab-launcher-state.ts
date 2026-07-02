import type { CandidateLabStatus } from "./lab-launcher-client";

export type LaunchState =
  | "idle"
  | "launching"
  | "open"
  | "suspending"
  | "ending"
  | "suspended"
  | "completed"
  | "error";

export type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";
export type RecoveryAction = "enter" | "resume" | "reopen";
export type LaunchAction = "enter" | "resume";
export type LauncherPresentation = {
  tone: "info" | "error";
  title: string;
  detail: string;
  primaryActionLabel: string | null;
  supportMessage: string | null;
};

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
    current.scheduledFor === next.scheduledFor &&
    current.openPeriodEndsAt === next.openPeriodEndsAt &&
    current.openPeriodClosed === next.openPeriodClosed
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
  openPeriodClosed = false,
): { action: RecoveryAction; label: string } | null {
  if (openPeriodClosed) {
    return null;
  }

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

export function getAttemptStatusAfterLaunchTransition(
  currentStatus: AttemptStatus,
  action: LaunchAction,
): AttemptStatus {
  if (action === "resume" && currentStatus === "suspended") {
    return "in_progress";
  }

  return currentStatus;
}

export function getLauncherPresentation(input: {
  state: LaunchState;
  attemptStatus: AttemptStatus;
  message: string;
  openPeriodClosed?: boolean;
}): LauncherPresentation {
  if (input.openPeriodClosed) {
    return {
      tone: "info",
      title: "Exam open period closed",
      detail: input.message || "This Exam open period has closed. Return to Candidate Home to review available score actions.",
      primaryActionLabel: null,
      supportMessage: null,
    };
  }

  switch (input.state) {
    case "launching":
      return {
        tone: "info",
        title: "Opening exam",
        detail: "Your CloudShare lab is opening in a new window.",
        primaryActionLabel: null,
        supportMessage: null,
      };
    case "open":
      return {
        tone: "info",
        title: "Exam window open",
        detail: "Your CloudShare lab opened in a separate window for this ExamAttempt.",
        primaryActionLabel: "Suspend lab",
        supportMessage:
          "Leaving or closing this page without suspending keeps your lab running and consuming time. Use Suspend lab to pause before stepping away.",
      };
    case "suspending":
      return {
        tone: "info",
        title: "Suspending lab",
        detail: "The portal is pausing your CloudShare lab and exam clock.",
        primaryActionLabel: null,
        supportMessage: null,
      };
    case "ending":
      return {
        tone: "info",
        title: "Ending exam",
        detail: "The portal is stopping your CloudShare lab before completing this ExamAttempt.",
        primaryActionLabel: null,
        supportMessage: null,
      };
    case "suspended":
      return {
        tone: "info",
        title: "Lab suspended",
        detail: input.message || "Lab suspended.",
        primaryActionLabel: "Resume exam",
        supportMessage: "Resume exam to reopen your CloudShare lab and continue the same ExamAttempt.",
      };
    case "completed":
      return {
        tone: "info",
        title: "Examination complete",
        detail: input.message || "Examination complete.",
        primaryActionLabel: null,
        supportMessage: null,
      };
    case "error": {
      const recoveryAction = getLauncherRecoveryAction(input.attemptStatus, input.openPeriodClosed);
      return {
        tone: "error",
        title: recoveryAction ? "Recover your exam window" : "Exam action unavailable",
        detail: input.message || "The portal could not complete that exam action.",
        primaryActionLabel: recoveryAction?.label ?? null,
        supportMessage: null,
      };
    }
    case "idle":
    default: {
      const recoveryAction = getLauncherRecoveryAction(input.attemptStatus, input.openPeriodClosed);
      return {
        tone: "info",
        title: recoveryAction?.action === "resume" ? "Ready to resume" : "Ready to launch",
        detail:
          recoveryAction?.action === "resume"
            ? "Resume exam to reopen your CloudShare lab in a new window."
            : "Enter exam to open your CloudShare lab in a new window.",
        primaryActionLabel: recoveryAction?.label ?? null,
        supportMessage: null,
      };
    }
  }
}
