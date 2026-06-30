import type { CandidateDashboardData } from "./candidate-scheduling";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import { formatCandidateAttemptStatus } from "./candidate-lab-state";

export interface CandidateScheduledAttemptView {
  readonly attemptId: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly scheduledFor: string | null;
  readonly status: CandidateDashboardData["attempts"][number]["status"];
  readonly canEnter: boolean;
  readonly waitingMessage: string | null;
}

export interface CandidateAttemptPrimaryAction {
  readonly label: "Enter exam" | "Return to exam" | "Resume exam" | "View score" | null;
  readonly disabled: boolean;
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
): boolean {
  return Boolean(
    attempt?.status === "ready" &&
      attempt.scheduledFor &&
      new Date(attempt.scheduledFor).getTime() <= nowMs,
  );
}

export function getAttemptWaitingMessage(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
): string | null {
  if (!attempt || attempt.status !== "ready" || !attempt.scheduledFor) {
    return null;
  }

  const scheduledForLabel = formatCandidateScheduledDateTime(attempt.scheduledFor);
  if (!scheduledForLabel) {
    return null;
  }

  return canEnterAttempt(attempt, nowMs)
    ? null
    : `Enter exam becomes available at ${scheduledForLabel}.`;
}

export function getAttemptPrimaryAction(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
): CandidateAttemptPrimaryAction {
  if (!attempt) {
    return { label: null, disabled: false };
  }

  switch (attempt.status) {
    case "ready":
      return {
        label: "Enter exam",
        disabled: !canEnterAttempt(attempt, nowMs),
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
  const examTitles = new Map(dashboard.exams.map((exam) => [exam.id, exam.title]));

  return [...dashboard.attempts]
    .sort((left, right) => (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? ""))
    .map((attempt) => ({
      attemptId: attempt.id,
      examId: attempt.examId,
      examTitle: examTitles.get(attempt.examId) ?? attempt.examId,
      scheduledFor: attempt.scheduledFor,
      status: attempt.status,
      canEnter: canEnterAttempt(attempt, nowMs),
      waitingMessage: getAttemptWaitingMessage(attempt, nowMs),
    }));
}

export function getNextEnterabilityWakeUpDelayMs(
  attempts: CandidateDashboardData["attempts"],
  nowMs: number,
): number | null {
  const nextScheduledForMs = attempts
    .filter((attempt) => attempt.status === "ready" && attempt.scheduledFor)
    .map((attempt) => new Date(attempt.scheduledFor as string).getTime())
    .filter((scheduledForMs) => Number.isFinite(scheduledForMs) && scheduledForMs > nowMs)
    .sort((left, right) => left - right)[0];

  if (nextScheduledForMs === undefined) {
    return null;
  }

  return Math.min(
    MAX_ENTERABILITY_WAKE_UP_DELAY_MS,
    Math.max(0, nextScheduledForMs - nowMs + ENTERABILITY_TIMER_FUZZ_MS),
  );
}
