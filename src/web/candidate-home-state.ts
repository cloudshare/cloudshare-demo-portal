import type { CandidateDashboardData } from "./candidate-scheduling";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import { formatCandidateAttemptStatus } from "./candidate-lab-state";

export interface CandidateScheduledAttemptView {
  readonly attemptId: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly timeLimitMinutes: number | null;
  readonly openPeriodMinutes: number | null;
  readonly scoreRetrievalEnabled: boolean;
  readonly storageLeaseMinutes: number | null;
  readonly scheduledFor: string | null;
  readonly scheduledEnd: string | null;
  readonly scheduledWindowLabel: string | null;
  readonly nextScheduleAvailableAt: string | null;
  readonly nextScheduleAvailableLabel: string | null;
  readonly status: CandidateDashboardData["attempts"][number]["status"];
  readonly displayStatus: CandidateDashboardData["attempts"][number]["status"];
  readonly canEnter: boolean;
  readonly waitingMessage: string | null;
  readonly coldStartWarning: string | null;
}

export interface CandidateAttemptPrimaryAction {
  readonly label: "Enter exam" | "Return to exam" | "Resume exam" | "View score" | null;
  readonly disabled: boolean;
}

export type CandidateAttemptStatusGroup =
  | "scheduled"
  | "in_progress"
  | "suspended"
  | "completed"
  | "expired";

export type CandidateAttemptStatusFilter = "live" | CandidateAttemptStatusGroup;

export interface CandidateAttemptStatusFilterView {
  readonly filter: CandidateAttemptStatusFilter;
  readonly label: string;
  readonly count: number;
}

export interface CandidateAttemptQueueState {
  readonly activeFilter: CandidateAttemptStatusFilter;
  readonly attempts: CandidateScheduledAttemptView[];
  readonly filters: CandidateAttemptStatusFilterView[];
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
export const COLD_START_WARNING_MESSAGE =
  "Scheduled within five hours: CloudShare may cold-start the environment on login.";
const COLD_START_WARNING_WINDOW_MS = 5 * 60 * 60 * 1000;
const LIVE_CANDIDATE_ATTEMPT_GROUPS = new Set<CandidateAttemptStatusGroup>([
  "scheduled",
  "in_progress",
  "suspended",
]);
const CANDIDATE_ATTEMPT_FILTER_LABELS: Record<CandidateAttemptStatusFilter, string> = {
  live: "Live",
  scheduled: "Scheduled / ready",
  in_progress: "In progress",
  suspended: "Suspended",
  completed: "Completed",
  expired: "Expired",
};
const CANDIDATE_ATTEMPT_FILTER_ORDER: CandidateAttemptStatusFilter[] = [
  "live",
  "scheduled",
  "in_progress",
  "suspended",
  "completed",
  "expired",
];

export function getLatestAttemptForExam(
  attempts: CandidateDashboardData["attempts"],
  examId: string,
) {
  return attempts
    .filter((attempt) => attempt.examId === examId)
    .sort((left, right) => (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? ""))[0] ?? null;
}

export function getCurrentAttemptForExam(
  attempts: CandidateDashboardData["attempts"],
  examId: string,
) {
  const sameExamAttempts = attempts
    .filter((attempt) => attempt.examId === examId)
    .sort((left, right) => (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? ""));

  return sameExamAttempts.find((attempt) => isScheduleBlockingAttemptStatus(attempt.status)) ??
    sameExamAttempts[0] ??
    null;
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

  if (attempt.status === "completed" && exam?.scoreRetrievalEnabled) {
    return {
      label: "View score",
      disabled: false,
    };
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
      return { label: null, disabled: false };
    default:
      return { label: null, disabled: false };
  }
}

export function getCandidateCurrentAttemptLabel(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs?: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): string {
  if (!attempt) {
    return "No attempt scheduled";
  }

  const scheduledFor = formatCandidateScheduledDateTime(attempt.scheduledFor);
  return `${formatCandidateAttemptStatus(getCandidateAttemptDisplayStatus(attempt, nowMs, exam))}${scheduledFor ? ` for ${scheduledFor}` : ""}`;
}

export function getCandidateAttemptDisplayStatus(
  attempt: CandidateDashboardData["attempts"][number],
  nowMs?: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): CandidateDashboardData["attempts"][number]["status"] {
  if (nowMs === undefined) {
    return attempt.status;
  }

  if (isAttemptOpenPeriodClosed(attempt, nowMs, exam)) {
    return getAttemptClosedDisplayStatus(attempt);
  }

  if (attempt.status === "ready" && isAttemptBeforeScheduledStart(attempt, nowMs)) {
    return "scheduled";
  }

  return attempt.status;
}

function isAttemptBeforeScheduledStart(
  attempt: CandidateDashboardData["attempts"][number],
  nowMs: number,
): boolean {
  if (!attempt.scheduledFor) {
    return false;
  }

  const scheduledForMs = new Date(attempt.scheduledFor).getTime();
  return Number.isFinite(scheduledForMs) && scheduledForMs > nowMs;
}

function getAttemptClosedDisplayStatus(
  attempt: CandidateDashboardData["attempts"][number],
): CandidateDashboardData["attempts"][number]["status"] {
  if (attempt.status === "scheduled" || attempt.status === "ready") {
    return "expired";
  }

  if (attempt.status === "in_progress" || attempt.status === "suspended") {
    return "completed";
  }

  return attempt.status;
}

export function buildScheduledAttemptViews(
  dashboard: CandidateDashboardData,
  nowMs: number,
): CandidateScheduledAttemptView[] {
  const exams = new Map(dashboard.exams.map((exam) => [exam.id, exam]));

  return [...dashboard.attempts]
    .sort((left, right) => (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? ""))
    .map((attempt) => {
      const exam = getAttemptExamContext(attempt, exams.get(attempt.examId) ?? null);
      return {
        attemptId: attempt.id,
        examId: attempt.examId,
        examTitle: exam?.title ?? attempt.examTitle ?? attempt.examId,
        timeLimitMinutes: exam?.timeLimitMinutes ?? attempt.timeLimitMinutes ?? null,
        openPeriodMinutes: exam?.openPeriodMinutes ?? attempt.openPeriodMinutes ?? null,
        scoreRetrievalEnabled: exam?.scoreRetrievalEnabled ?? attempt.scoreRetrievalEnabled === true,
        storageLeaseMinutes: exam?.storageLeaseMinutes ?? attempt.storageLeaseMinutes ?? null,
        scheduledFor: attempt.scheduledFor,
        scheduledEnd: getAttemptOpenPeriodEnd(attempt, exam),
        scheduledWindowLabel: getAttemptOpenPeriodLabel(attempt, exam),
        nextScheduleAvailableAt: getAttemptNextScheduleAvailableAt(attempt, exam),
        nextScheduleAvailableLabel: getAttemptNextScheduleAvailableLabel(attempt, exam),
        status: attempt.status,
        displayStatus: getCandidateAttemptDisplayStatus(attempt, nowMs, exam),
        canEnter: canEnterAttempt(attempt, nowMs, exam),
        waitingMessage: getAttemptWaitingMessage(attempt, nowMs, exam),
        coldStartWarning: getAttemptColdStartWarning(attempt, nowMs, exam),
      };
    });
}

export function buildCandidateAttemptQueueState(
  dashboard: CandidateDashboardData,
  nowMs: number,
  activeFilter: CandidateAttemptStatusFilter = "live",
): CandidateAttemptQueueState {
  const views = buildScheduledAttemptViews(dashboard, nowMs);
  const groupedViews = views.map((attempt) => ({
    attempt,
    group: getCandidateAttemptStatusGroup(attempt),
  }));
  const filters = CANDIDATE_ATTEMPT_FILTER_ORDER.map((filter) => ({
    filter,
    label: CANDIDATE_ATTEMPT_FILTER_LABELS[filter],
    count: groupedViews.filter(({ group }) =>
      filter === "live" ? LIVE_CANDIDATE_ATTEMPT_GROUPS.has(group) : group === filter,
    ).length,
  }));

  return {
    activeFilter,
    attempts: groupedViews
      .filter(({ group }) =>
        activeFilter === "live" ? LIVE_CANDIDATE_ATTEMPT_GROUPS.has(group) : group === activeFilter,
      )
      .map(({ attempt }) => attempt),
    filters,
  };
}

function getCandidateAttemptStatusGroup(
  attempt: CandidateScheduledAttemptView,
): CandidateAttemptStatusGroup {
  if (attempt.displayStatus === "ready") {
    return "scheduled";
  }
  return attempt.displayStatus;
}

export function getAttemptColdStartWarning(
  attempt: CandidateDashboardData["attempts"][number] | null,
  nowMs: number,
  exam?: CandidateDashboardData["exams"][number] | null,
): string | null {
  if (!attempt?.scheduledFor) {
    return null;
  }

  if (isAttemptOpenPeriodClosed(attempt, nowMs, exam)) {
    return null;
  }

  if (
    attempt.status !== "scheduled" &&
    attempt.status !== "ready" &&
    attempt.status !== "in_progress" &&
    attempt.status !== "suspended"
  ) {
    return null;
  }

  const scheduledForMs = new Date(attempt.scheduledFor).getTime();
  if (!Number.isFinite(scheduledForMs)) {
    return null;
  }

  const msUntilStart = scheduledForMs - nowMs;
  const msSinceStart = nowMs - scheduledForMs;

  return msUntilStart < COLD_START_WARNING_WINDOW_MS &&
    msSinceStart <= COLD_START_WARNING_WINDOW_MS
    ? COLD_START_WARNING_MESSAGE
    : null;
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

  return `Starts ${startLabel} · Closes ${endLabel} (${exam.openPeriodMinutes} min)`;
}

function getAttemptOpenPeriodEndMs(
  attempt: CandidateDashboardData["attempts"][number] | null,
  exam: CandidateDashboardData["exams"][number] | null | undefined,
): number | null {
  const openPeriodMinutes = exam?.openPeriodMinutes ?? attempt?.openPeriodMinutes;
  if (!attempt?.scheduledFor || !openPeriodMinutes) {
    return null;
  }

  const scheduledForMs = new Date(attempt.scheduledFor).getTime();
  if (!Number.isFinite(scheduledForMs)) {
    return null;
  }

  return scheduledForMs + openPeriodMinutes * 60_000;
}

function getAttemptSchedulingAvailabilityEndMs(
  attempt: CandidateDashboardData["attempts"][number] | null,
  exam: CandidateDashboardData["exams"][number] | null | undefined,
): number | null {
  if (!attempt || !isScheduleBlockingAttemptStatus(attempt.status)) {
    return null;
  }

  const retentionMinutes =
    exam?.storageLeaseMinutes ??
    attempt?.storageLeaseMinutes ??
    exam?.openPeriodMinutes ??
    attempt?.openPeriodMinutes;
  if (!attempt?.scheduledFor || !retentionMinutes) {
    return null;
  }

  const scheduledForMs = new Date(attempt.scheduledFor).getTime();
  if (!Number.isFinite(scheduledForMs)) {
    return null;
  }

  return scheduledForMs + retentionMinutes * 60_000;
}

export function getAttemptNextScheduleAvailableAt(
  attempt: CandidateDashboardData["attempts"][number] | null,
  exam?: CandidateDashboardData["exams"][number] | null,
): string | null {
  const endMs = getAttemptSchedulingAvailabilityEndMs(attempt, exam);
  return endMs === null ? null : new Date(endMs).toISOString();
}

export function getAttemptNextScheduleAvailableLabel(
  attempt: CandidateDashboardData["attempts"][number] | null,
  exam?: CandidateDashboardData["exams"][number] | null,
): string | null {
  return formatCandidateScheduledDateTime(getAttemptNextScheduleAvailableAt(attempt, exam));
}

export function getNextScheduleAvailableLabelForExam(
  attempts: CandidateDashboardData["attempts"],
  examId: string,
  exam?: CandidateDashboardData["exams"][number] | null,
): string | null {
  const nextAvailableMs = attempts
    .filter((attempt) => attempt.examId === examId)
    .map((attempt) => getAttemptSchedulingAvailabilityEndMs(attempt, exam))
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left)[0];

  return nextAvailableMs === undefined
    ? null
    : formatCandidateScheduledDateTime(new Date(nextAvailableMs).toISOString());
}

function isScheduleBlockingAttemptStatus(
  status: CandidateDashboardData["attempts"][number]["status"],
): boolean {
  return status !== "completed" && status !== "expired";
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

function getAttemptExamContext(
  attempt: CandidateDashboardData["attempts"][number],
  exam: CandidateDashboardData["exams"][number] | null,
): CandidateDashboardData["exams"][number] | null {
  if (exam) {
    return exam;
  }
  if (
    typeof attempt.examTitle !== "string" ||
    typeof attempt.timeLimitMinutes !== "number" ||
    typeof attempt.openPeriodMinutes !== "number"
  ) {
    return null;
  }
  return {
    id: attempt.examId,
    title: attempt.examTitle,
    description: "",
    timeLimitMinutes: attempt.timeLimitMinutes,
    storageLeaseMinutes: attempt.storageLeaseMinutes ?? null,
    openPeriodMinutes: attempt.openPeriodMinutes,
    scoreRetrievalEnabled: attempt.scoreRetrievalEnabled === true,
  };
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
