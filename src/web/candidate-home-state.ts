import type { CandidateDashboardData } from "./candidate-scheduling";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import { formatCandidateAttemptStatus } from "./candidate-lab-state";

export interface CandidateScheduledAttemptView {
  readonly attemptId: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly scheduledFor: string | null;
  readonly scheduledEnd: string | null;
  readonly scheduledWindowLabel: string | null;
  readonly status: CandidateDashboardData["attempts"][number]["status"];
  readonly canEnter: boolean;
  readonly waitingMessage: string | null;
}

export interface CandidateAttemptPrimaryAction {
  readonly label: "Enter exam" | "Return to exam" | "Resume exam" | "View score" | null;
  readonly disabled: boolean;
}

export function buildCandidateExamDurationLabels(
  exam: CandidateDashboardData["exams"][number],
): { readonly runtimeLimit: string; readonly openWindow: string; readonly openPeriodDetail: string } {
  return {
    runtimeLimit: `${exam.timeLimitMinutes} minute runtime limit`,
    openWindow: `${exam.openPeriodMinutes} minute open window`,
    openPeriodDetail: `${exam.openPeriodMinutes} minutes from scheduled start`,
  };
}

const ENTERABILITY_TIMER_FUZZ_MS = 250;
export const MAX_ENTERABILITY_WAKE_UP_DELAY_MS = 24 * 60 * 60 * 1000;

export function getLatestAttemptForExam(
  attempts: CandidateDashboardData["attempts"],
  examId: string,
) {
  return attempts
    .filter((attempt) => attempt.examId === examId)
    .sort((left, right) => (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? ""))[0] ?? null;
}

export function canEnterAttempt(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): boolean {
  return Boolean(
    attempt?.status === "ready" &&
      attempt.scheduledFor &&
      new Date(attempt.scheduledFor).getTime() <= nowMs &&
      !isAttemptOpenPeriodClosed(attempt, nowMs, exam),
  );
}

export function getAttemptWaitingMessage(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): string | null {
  if (!attempt || attempt.status !== "ready" || !attempt.scheduledFor) {
    return null;
  }

  const scheduledForLabel = formatCandidateScheduledDateTime(attempt.scheduledFor);
  if (!scheduledForLabel) {
    return null;
  }

  if (isAttemptOpenPeriodClosed(attempt, nowMs, exam)) {
    return "This Exam open period has closed.";
  }

  return canEnterAttempt(attempt, nowMs, exam)
    ? null
    : `Enter exam becomes available at ${scheduledForLabel}.`;
}

export function getAttemptPrimaryAction(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): CandidateAttemptPrimaryAction {
  if (!attempt) {
    return { label: null, disabled: false };
  }

  if (isAttemptOpenPeriodClosed(attempt, nowMs, exam)) {
    return isStartedAttemptStatus(attempt.status) && exam?.scoreRetrievalEnabled
      ? { label: "View score", disabled: false }
      : { label: null, disabled: false };
  }

  switch (attempt.status) {
    case "ready":
      return {
        label: "Enter exam",
        disabled: !canEnterAttempt(attempt, nowMs, exam),
      };
    case "in_progress":
      return {
        label: "Return to exam",
        disabled: false,
      };
    case "suspended":
      return {
        label: "Resume exam",
        disabled: false,
      };
    case "completed":
      return {
        label: "View score",
        disabled: false,
      };
    default:
      return { label: null, disabled: false };
  }
}

export function getCandidateCurrentAttemptLabel(
  attempt: CandidateDashboardData["attempts"][number] | null,
): string {
  if (!attempt) {
    return "No attempt scheduled";
  }

  const scheduledFor = formatCandidateScheduledDateTime(attempt.scheduledFor);
  return `${formatCandidateAttemptStatus(attempt.status)}${scheduledFor ? ` for ${scheduledFor}` : ""}`;
}

export function buildScheduledAttemptViews(
  dashboard: CandidateDashboardData,
  nowMs: number,
): CandidateScheduledAttemptView[] {
  const exams = new Map(dashboard.exams.map((exam) => [exam.id, exam]));

  return [...dashboard.attempts]
    .sort((left, right) => (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? ""))
    .map((attempt) => {
      const exam = exams.get(attempt.examId) ?? null;
      return {
        attemptId: attempt.id,
        examId: attempt.examId,
        examTitle: exam?.title ?? attempt.examId,
        scheduledFor: attempt.scheduledFor,
        scheduledEnd: getAttemptOpenPeriodEnd(attempt, exam),
        scheduledWindowLabel: getAttemptOpenPeriodLabel(attempt, exam),
        status: attempt.status,
        canEnter: canEnterAttempt(attempt, nowMs, exam),
        waitingMessage: getAttemptWaitingMessage(attempt, nowMs, exam),
      };
    });
}

function getAttemptOpenPeriodEnd(
  attempt: CandidateDashboardData["attempts"][number],
  exam: CandidateDashboardData["exams"][number] | null,
): string | null {
  const endMs = getAttemptOpenPeriodEndMs(attempt, exam);
  return endMs === null ? null : new Date(endMs).toISOString();
}

function getAttemptOpenPeriodLabel(
  attempt: CandidateDashboardData["attempts"][number],
  exam: CandidateDashboardData["exams"][number] | null,
): string | null {
  if (!attempt.scheduledFor || !exam) {
    return null;
  }

  const startLabel = formatCandidateScheduledDateTime(attempt.scheduledFor);
  const end = getAttemptOpenPeriodEnd(attempt, exam);
  const endLabel = formatCandidateScheduledDateTime(end);
  if (!startLabel || !endLabel) {
    return null;
  }

  return `${startLabel} to ${endLabel} (${exam.openPeriodMinutes} min)`;
}

function getAttemptOpenPeriodEndMs(
  attempt: CandidateDashboardData["attempts"][number] | null,
  exam: CandidateDashboardData["exams"][number] | null | undefined,
): number | null {
  if (!attempt?.scheduledFor || !exam?.openPeriodMinutes) {
    return null;
  }

  const scheduledForMs = new Date(attempt.scheduledFor).getTime();
  if (!Number.isFinite(scheduledForMs)) {
    return null;
  }

  return scheduledForMs + exam.openPeriodMinutes * 60_000;
}

function isAttemptOpenPeriodClosed(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): boolean {
  const endMs = getAttemptOpenPeriodEndMs(attempt, exam);
  return endMs !== null && nowMs >= endMs;
}

function isStartedAttemptStatus(status: CandidateDashboardData["attempts"][number]["status"]): boolean {
  return status === "in_progress" || status === "suspended" || status === "completed";
}

export function getNextEnterabilityWakeUpDelayMs(
  attempts: CandidateDashboardData["attempts"],
  nowMs: number,
  exams: CandidateDashboardData["exams"] = [],
): number | null {
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const nextScheduledForMs = attempts
    .filter((attempt) => attempt.status === "ready" && attempt.scheduledFor)
    .map((attempt) => new Date(attempt.scheduledFor as string).getTime())
    .filter((scheduledForMs) => Number.isFinite(scheduledForMs) && scheduledForMs > nowMs)
    .sort((left, right) => left - right)[0];
  const nextOpenPeriodCloseMs = attempts
    .filter((attempt) => attempt.status === "ready" || attempt.status === "in_progress" || attempt.status === "suspended")
    .map((attempt) => getAttemptOpenPeriodEndMs(attempt, examsById.get(attempt.examId) ?? null))
    .filter((endMs): endMs is number => endMs !== null && endMs > nowMs)
    .sort((left, right) => left - right)[0];
  const nextWakeUpMs = [nextScheduledForMs, nextOpenPeriodCloseMs]
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)[0];

  if (nextWakeUpMs === undefined) {
    return null;
  }

  return Math.min(
    MAX_ENTERABILITY_WAKE_UP_DELAY_MS,
    Math.max(0, nextWakeUpMs - nowMs + ENTERABILITY_TIMER_FUZZ_MS),
  );
}
