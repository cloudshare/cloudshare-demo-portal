import {
  buildScheduledAttemptViews,
  type CandidateScheduledAttemptView,
} from "./candidate-home-state";
import type { CandidateDashboardData } from "./candidate-scheduling";
import { isCandidateTaskView, isValidCandidateIdentifier, isValidCandidateRouteShape } from "../auth/candidate-route-shape";
import type { CandidateTaskView } from "../auth/candidate-route-shape";
export { isValidCandidateIdentifier } from "../auth/candidate-route-shape";
export type { CandidateTaskView } from "../auth/candidate-route-shape";
import { isCandidateLabHistoryPresentation } from "./candidate-lab-state";

type CandidateAttemptStatus = CandidateDashboardData["attempts"][number]["status"];

export interface CandidateTaskRoute {
  readonly task: CandidateTaskView | null;
  readonly attemptId: string | null;
  readonly examId: string | null;
}

export interface CandidateTaskTab {
  readonly task: CandidateTaskView;
  readonly label: string;
  readonly count: number;
}

export interface ResolvedCandidateTaskRoute {
  readonly activeTask: CandidateTaskView;
  readonly attempts: readonly CandidateScheduledAttemptView[];
  readonly candidateAttempts: readonly CandidateScheduledAttemptView[];
  readonly selectedAttempt: CandidateScheduledAttemptView | null;
  readonly exams: readonly CandidateDashboardData["exams"][number][];
  readonly selectedExam: CandidateDashboardData["exams"][number] | null;
  readonly notice: string | null;
  readonly tasks: readonly CandidateTaskTab[];
}

const CANDIDATE_TASK_LABELS: Record<CandidateTaskView, string> = {
  current: "Current Exam Attempt",
  schedule: "Schedule exam",
  history: "Attempt history",
};

export function parseCandidateTaskRoute(input: {
  readonly task?: string | null;
  readonly attemptId?: string | null;
  readonly examId?: string | null;
}): CandidateTaskRoute {
  return {
    task: isCandidateTaskView(input.task) ? input.task : null,
    attemptId: normalizeCandidateRouteId(input.attemptId),
    examId: normalizeCandidateRouteId(input.examId),
  };
}

export function resolveCandidateTaskRoute(
  dashboard: CandidateDashboardData,
  nowMs: number,
  route: CandidateTaskRoute,
): ResolvedCandidateTaskRoute {
  const attempts = buildScheduledAttemptViews(dashboard, nowMs);
  const liveAttempts = attempts.filter(isLiveCandidateAttempt).sort(compareCurrentAttempts);
  const historyAttempts = attempts.filter(isHistoryCandidateAttempt);
  const tasks: CandidateTaskTab[] = [
    { task: "current", label: CANDIDATE_TASK_LABELS.current, count: liveAttempts.length },
    { task: "schedule", label: CANDIDATE_TASK_LABELS.schedule, count: dashboard.exams.length },
    { task: "history", label: CANDIDATE_TASK_LABELS.history, count: historyAttempts.length },
  ];

  const desiredTask = route.task ?? getDefaultCandidateTask(liveAttempts, dashboard.exams, historyAttempts);

  if (desiredTask === "current") {
    if (liveAttempts.length === 0) {
      return buildFallbackTaskResult(
        dashboard,
        nowMs,
        dashboard.exams.length > 0
          ? "No live Exam Attempt is available right now. Choose another published Exam."
          : "No live Exam Attempt is available right now, and no published Exams are available yet.",
        tasks,
      );
    }

    const selectedAttempt =
      selectAttemptById(liveAttempts, route.attemptId)
      ?? [...liveAttempts].sort(compareCurrentAttemptNavigationPriority)[0]
      ?? null;

    return {
      activeTask: "current",
      attempts: liveAttempts,
      candidateAttempts: attempts,
      selectedAttempt,
      exams: orderPublishedExams(dashboard.exams),
      selectedExam: selectExamById(dashboard.exams, route.examId),
      notice:
        route.attemptId && !selectAttemptById(liveAttempts, route.attemptId)
          ? "The requested Exam Attempt is no longer available in this live task view."
          : null,
      tasks,
    };
  }

  if (desiredTask === "history") {
    if (historyAttempts.length === 0) {
      return buildFallbackTaskResult(
        dashboard,
        nowMs,
        dashboard.exams.length > 0
          ? "No completed Exam Attempt history is available yet. Choose another published Exam."
          : "No completed Exam Attempt history is available yet.",
        tasks,
      );
    }

    const selectedAttempt =
      selectAttemptById(historyAttempts, route.attemptId) ?? historyAttempts[0] ?? null;

    return {
      activeTask: "history",
      attempts: historyAttempts,
      candidateAttempts: attempts,
      selectedAttempt,
      exams: orderPublishedExams(dashboard.exams),
      selectedExam: selectExamById(dashboard.exams, route.examId),
      notice:
        route.attemptId && !selectAttemptById(historyAttempts, route.attemptId)
          ? "The requested Exam Attempt is no longer available in this history view."
          : null,
      tasks,
    };
  }

  const orderedExams = orderPublishedExams(dashboard.exams);
  const selectedExam = selectExamById(dashboard.exams, route.examId) ?? orderedExams[0] ?? null;
  if (orderedExams.length === 0) {
    return {
      activeTask: "schedule",
      attempts,
      candidateAttempts: attempts,
      selectedAttempt: null,
      exams: [],
      selectedExam: null,
      notice: "No published Exams are available yet.",
      tasks,
    };
  }

  return {
    activeTask: "schedule",
    attempts,
    candidateAttempts: attempts,
    selectedAttempt: null,
    exams: orderedExams,
    selectedExam,
    notice:
      route.examId && !selectExamById(dashboard.exams, route.examId)
        ? "That published Exam is no longer available. Choose another published Exam."
        : null,
    tasks,
  };
}

export function buildCandidateTaskHref(route: CandidateTaskRoute): string {
  const params = new URLSearchParams();
  if (route.task) {
    params.set("task", route.task);
  }
  if (route.attemptId) {
    params.set("attemptId", route.attemptId);
  }
  if (route.examId) {
    params.set("examId", route.examId);
  }
  const query = params.toString();
  return query.length > 0 ? `/candidate?${query}` : "/candidate";
}

export function parseCandidateTaskSearchParams(
  searchParams: URLSearchParams,
  fallback: CandidateTaskRoute,
): CandidateTaskRoute {
  // An empty query is the only case where the server-rendered route is useful.
  // Once the browser supplies a query, parse the complete route atomically so
  // Back/Forward cannot combine a new partial URL with stale initial props.
  if ([...searchParams.keys()].length === 0) return fallback;
  const supported = new Set(["task", "attemptId", "examId"]);
  const entries = [...searchParams.entries()];
  if (entries.some(([key]) => !supported.has(key))) return emptyCandidateTaskRoute();
  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    if (values.has(key) || value.trim() !== value || value.length === 0) return emptyCandidateTaskRoute();
    values.set(key, value);
  }
  const route = parseCandidateTaskRoute({
    task: values.get("task"),
    attemptId: values.get("attemptId"),
    examId: values.get("examId"),
  });
  if (!route.task || (route.attemptId && !isValidCandidateIdentifier(route.attemptId)) || (route.examId && !isValidCandidateIdentifier(route.examId)) || !isValidCandidateRouteShape({ task: route.task, hasAttemptId: values.has("attemptId"), hasExamId: values.has("examId") })) {
    return emptyCandidateTaskRoute();
  }
  return route;
}

export function getCandidateTaskNavigationRoute(
  task: CandidateTaskView,
  resolved: ResolvedCandidateTaskRoute,
): CandidateTaskRoute {
  const destinationAttempts = task === "current"
    ? resolved.candidateAttempts.filter(isLiveCandidateAttempt)
    : task === "history"
      ? resolved.candidateAttempts.filter(isHistoryCandidateAttempt)
      : resolved.candidateAttempts;
  const attemptForDestination = (task === "current"
    ? [...destinationAttempts].sort(compareCurrentAttemptNavigationPriority)
    : destinationAttempts)[0] ?? null;
  if (task === "schedule") {
    const selectedScheduleExam = resolved.activeTask === "schedule"
      ? resolved.selectedExam
      : null;
    const attemptedExamIds = new Set(resolved.candidateAttempts.map((attempt) => attempt.examId));
    const availableExam = [...resolved.exams]
      .filter((exam) => !attemptedExamIds.has(exam.id))
      .sort(compareCandidateExamsByIdForFallback)[0]
      ?? [...resolved.exams].sort(compareCandidateExamsByIdForFallback)[0]
      ?? null;
    return { task, attemptId: null, examId: selectedScheduleExam?.id ?? availableExam?.id ?? null };
  }
  if (task === "current" || task === "history") {
    const selected = resolved.activeTask === task && resolved.selectedAttempt && destinationAttempts.some(
      (attempt) => attempt.attemptId === resolved.selectedAttempt?.attemptId,
    ) ? resolved.selectedAttempt : attemptForDestination;
    return { task, attemptId: selected?.attemptId ?? null, examId: selected?.examId ?? null };
  }
  return { task: null, attemptId: null, examId: null };
}

function compareCandidateExamsByIdForFallback(
  left: CandidateDashboardData["exams"][number],
  right: CandidateDashboardData["exams"][number],
): number {
  return left.id.localeCompare(right.id) || left.title.localeCompare(right.title);
}

export function getCandidateTaskForAttemptStatus(
  status: CandidateAttemptStatus,
  openPeriodClosed = false,
): CandidateTaskView {
  return isCandidateLabHistoryPresentation(status, openPeriodClosed) ? "history" : "current";
}

function buildFallbackTaskResult(
  dashboard: CandidateDashboardData,
  nowMs: number,
  notice: string,
  tasks: readonly CandidateTaskTab[],
): ResolvedCandidateTaskRoute {
  if (dashboard.exams.length > 0) {
    const exams = orderPublishedExams(dashboard.exams);
    return {
      activeTask: "schedule",
      attempts: buildScheduledAttemptViews(dashboard, nowMs),
      candidateAttempts: buildScheduledAttemptViews(dashboard, nowMs),
      selectedAttempt: null,
      exams,
      selectedExam: exams[0] ?? null,
      notice,
      tasks,
    };
  }

  const historyAttempts = buildScheduledAttemptViews(dashboard, nowMs).filter(isHistoryCandidateAttempt);
  return {
    activeTask: "history",
    attempts: historyAttempts,
    candidateAttempts: buildScheduledAttemptViews(dashboard, nowMs),
    selectedAttempt: historyAttempts[0] ?? null,
    exams: [],
    selectedExam: null,
    notice,
    tasks,
  };
}

function getDefaultCandidateTask(
  liveAttempts: readonly CandidateScheduledAttemptView[],
  exams: readonly CandidateDashboardData["exams"][number][],
  historyAttempts: readonly CandidateScheduledAttemptView[],
): CandidateTaskView {
  if (liveAttempts.length > 0) {
    return "current";
  }
  if (exams.length > 0) {
    return "schedule";
  }
  if (historyAttempts.length > 0) {
    return "history";
  }
  return "schedule";
}

function normalizeCandidateRouteId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLiveCandidateAttempt(attempt: CandidateScheduledAttemptView): boolean {
  return (
    attempt.displayStatus === "scheduled" ||
    attempt.displayStatus === "ready" ||
    attempt.displayStatus === "in_progress" ||
    attempt.displayStatus === "suspended"
  );
}

function isHistoryCandidateAttempt(attempt: CandidateScheduledAttemptView): boolean {
  return attempt.displayStatus === "completed" || attempt.displayStatus === "expired";
}


function emptyCandidateTaskRoute(): CandidateTaskRoute {
  return { task: null, attemptId: null, examId: null };
}

function compareCurrentAttempts(
  left: CandidateScheduledAttemptView,
  right: CandidateScheduledAttemptView,
): number {
  return (right.scheduledFor ?? "").localeCompare(left.scheduledFor ?? "")
    || left.attemptId.localeCompare(right.attemptId);
}

function compareCurrentAttemptNavigationPriority(
  left: CandidateScheduledAttemptView,
  right: CandidateScheduledAttemptView,
): number {
  const priority = (attempt: CandidateScheduledAttemptView) => {
    switch (attempt.displayStatus) {
      case "in_progress":
        return 0;
      case "suspended":
        return 1;
      case "ready":
        return 2;
      default:
        return 3;
    }
  };
  return priority(left) - priority(right) || compareCurrentAttempts(left, right);
}

function selectAttemptById(
  attempts: readonly CandidateScheduledAttemptView[],
  attemptId: string | null,
): CandidateScheduledAttemptView | null {
  return attempts.find((attempt) => attempt.attemptId === attemptId) ?? null;
}

function selectExamById(
  exams: readonly CandidateDashboardData["exams"][number][],
  examId: string | null,
): CandidateDashboardData["exams"][number] | null {
  return exams.find((exam) => exam.id === examId) ?? null;
}

function orderPublishedExams(
  exams: readonly CandidateDashboardData["exams"][number][],
): CandidateDashboardData["exams"][number][] {
  // Keep the published catalogue in one deterministic order so refreshes do
  // not make the user's selected card appear to jump.
  return [...exams].sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}
