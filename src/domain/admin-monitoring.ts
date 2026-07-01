import type { DiagnosticLogEntry } from "./diagnostic-log";
import type { ActiveExamAttemptStatus } from "./exam-attempt";

export interface MonitoringAttemptRecord {
  readonly id: string;
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName: string | null;
  readonly candidateLastName: string | null;
  readonly examId: string;
  readonly examTitle: string;
  readonly examOpenPeriodMinutes: number;
  readonly status: ActiveExamAttemptStatus;
  readonly scheduledFor: Date | null;
  readonly createdAt: Date;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
  readonly participantId: string | null;
  readonly scoreRetrievalEnabled: boolean;
}

export interface AdminMonitoringSummary {
  readonly scheduled: number;
  readonly ready: number;
  readonly inProgress: number;
  readonly suspended: number;
  readonly completed: number;
  readonly expired: number;
}

export interface MonitoringAttemptPage {
  readonly attempts: readonly MonitoringAttemptRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface AdminMonitoringAttemptRepository {
  countSummaryByCustomerId(customerId: string): Promise<AdminMonitoringSummary>;
  listCurrentByCustomerId(customerId: string): Promise<MonitoringAttemptRecord[]>;
  listHistoryPageByCustomerId(
    customerId: string,
    page: AdminMonitoringHistoryPageRequest,
  ): Promise<MonitoringAttemptPage>;
}

export interface MonitoringTimelineDiagnosticEntry {
  readonly id: string;
  readonly kind: "diagnostic";
  readonly occurredAt: string;
  readonly level: DiagnosticLogEntry["level"];
  readonly source: string;
  readonly operation: string;
  readonly outcome: DiagnosticLogEntry["outcome"];
  readonly message: string;
  readonly details?: Record<string, string | number | boolean | null>;
  readonly correlationId?: string | null;
}

export type MonitoringTimelineEntry = MonitoringTimelineDiagnosticEntry;

export interface MonitoringAttemptResult {
  readonly status: "completed" | "expired";
  readonly scoreAvailable: boolean;
  readonly percentComplete?: number;
  readonly stepsCompleted?: number;
  readonly stepsTotal?: number;
}

export interface AdminMonitoringHistoryPageRequest {
  readonly limit: number;
  readonly offset: number;
}

export interface AdminMonitoringHistoryPage {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
}

export interface MonitoringAttemptView {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly examOpenPeriodMinutes: number;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string;
  readonly status: MonitoringAttemptRecord["status"];
  readonly scheduledFor: string | null;
  readonly createdAt: string;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
  readonly participantId: string | null;
  readonly scoreRetrievalEnabled: boolean;
  readonly timeline: readonly MonitoringTimelineEntry[];
  readonly result?: MonitoringAttemptResult;
}

export interface AdminMonitoringView {
  readonly summary: AdminMonitoringSummary;
  readonly currentAttempts: {
    readonly scheduled: readonly MonitoringAttemptView[];
    readonly ready: readonly MonitoringAttemptView[];
    readonly inProgress: readonly MonitoringAttemptView[];
    readonly suspended: readonly MonitoringAttemptView[];
  };
  readonly history: readonly MonitoringAttemptView[];
  readonly historyPage: AdminMonitoringHistoryPage;
}

export function buildAdminMonitoringView(input: {
  readonly summary: AdminMonitoringSummary;
  readonly currentAttempts: readonly MonitoringAttemptRecord[];
  readonly history: MonitoringAttemptPage;
  readonly diagnosticRecords: readonly DiagnosticLogEntry[];
  readonly now?: Date;
}): AdminMonitoringView {
  const now = input.now ?? new Date();
  const diagnosticsByAttemptId = groupBy(
    input.diagnosticRecords.filter(
      (record): record is DiagnosticLogEntry & { examAttemptId: string } =>
        typeof record.examAttemptId === "string" && record.examAttemptId.length > 0,
    ),
    (record) => record.examAttemptId,
  );

  const currentAttemptsWithDerivedStatus = [...input.currentAttempts]
    .sort(compareAttemptsNewestFirst)
    .map((attempt) => ({
      raw: attempt,
      derived: deriveMonitoringAttemptStatus(attempt, now),
    }));
  const currentAttemptViews = currentAttemptsWithDerivedStatus
    .map((attempt) =>
      toAttemptView(
        attempt.derived,
        diagnosticsByAttemptId.get(attempt.derived.id) ?? [],
      ),
    );
  const historyAttemptViews = [...input.history.attempts]
    .sort(compareAttemptsNewestFirst)
    .map((attempt) =>
      toAttemptView(
        deriveMonitoringAttemptStatus(attempt, now),
        diagnosticsByAttemptId.get(attempt.id) ?? [],
      ),
    );
  const liveAttemptViews = currentAttemptViews.filter(
    (attempt) =>
      attempt.status === "scheduled" ||
      attempt.status === "ready" ||
      attempt.status === "in_progress" ||
      attempt.status === "suspended",
  );
  const derivedTerminalViews = currentAttemptViews.filter(
    (attempt) => attempt.status === "completed" || attempt.status === "expired",
  );
  const terminalHistoryViews = [...derivedTerminalViews, ...historyAttemptViews].sort(
    compareAttemptViewsNewestFirst,
  );
  const historyOffset = boundMonitoringHistoryOffset(input.history.offset);
  const historyLimit = boundMonitoringHistoryLimit(input.history.limit);
  const hasMore = historyOffset + historyAttemptViews.length < input.history.total;

  return {
    summary: deriveMonitoringSummary(input.summary, currentAttemptsWithDerivedStatus),
    currentAttempts: {
      scheduled: liveAttemptViews.filter((attempt) => attempt.status === "scheduled"),
      ready: liveAttemptViews.filter((attempt) => attempt.status === "ready"),
      inProgress: liveAttemptViews.filter((attempt) => attempt.status === "in_progress"),
      suspended: liveAttemptViews.filter((attempt) => attempt.status === "suspended"),
    },
    history: terminalHistoryViews,
    historyPage: {
      limit: historyLimit,
      offset: historyOffset,
      returned: terminalHistoryViews.length,
      total: input.history.total + derivedTerminalViews.length,
      hasMore,
      nextOffset: hasMore ? historyOffset + historyAttemptViews.length : null,
    },
  };
}

function toAttemptView(
  attempt: MonitoringAttemptRecord,
  diagnosticRecords: readonly DiagnosticLogEntry[],
): MonitoringAttemptView {
  return {
    id: attempt.id,
    examId: attempt.examId,
    examTitle: attempt.examTitle,
    candidateId: attempt.candidateId,
    candidateName: formatCandidateName(attempt),
    candidateEmail: attempt.candidateEmail,
    status: attempt.status,
    examOpenPeriodMinutes: attempt.examOpenPeriodMinutes,
    scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
    createdAt: attempt.createdAt.toISOString(),
    trainingId: attempt.trainingId,
    experienceId: attempt.experienceId,
    environmentExternalId: attempt.environmentExternalId,
    participantId: attempt.participantId,
    scoreRetrievalEnabled: attempt.scoreRetrievalEnabled,
    timeline: buildTimeline(diagnosticRecords),
    result: buildResult(attempt.status, diagnosticRecords),
  };
}

function deriveMonitoringAttemptStatus(
  attempt: MonitoringAttemptRecord,
  now: Date,
): MonitoringAttemptRecord {
  if (!isOpenPeriodClosed(attempt, now)) {
    return attempt;
  }

  if (attempt.status === "scheduled" || attempt.status === "ready") {
    return { ...attempt, status: "expired" };
  }

  if (attempt.status === "in_progress" || attempt.status === "suspended") {
    return { ...attempt, status: "completed" };
  }

  return attempt;
}

function isOpenPeriodClosed(
  attempt: Pick<MonitoringAttemptRecord, "scheduledFor" | "examOpenPeriodMinutes">,
  now: Date,
): boolean {
  if (!attempt.scheduledFor || !Number.isFinite(attempt.examOpenPeriodMinutes)) {
    return false;
  }

  return now.getTime() >= attempt.scheduledFor.getTime() + attempt.examOpenPeriodMinutes * 60_000;
}

function deriveMonitoringSummary(
  rawSummary: AdminMonitoringSummary,
  currentAttemptsWithDerivedStatus: readonly {
    readonly raw: MonitoringAttemptRecord;
    readonly derived: MonitoringAttemptRecord;
  }[],
): AdminMonitoringSummary {
  const counts = {
    scheduled: rawSummary.scheduled,
    ready: rawSummary.ready,
    inProgress: rawSummary.inProgress,
    suspended: rawSummary.suspended,
    completed: rawSummary.completed,
    expired: rawSummary.expired,
  };
  for (const { raw, derived } of currentAttemptsWithDerivedStatus) {
    if (raw.status === derived.status) {
      continue;
    }
    decrementSummaryStatus(counts, raw.status);
    incrementSummaryStatus(counts, derived.status);
  }
  return counts;
}

type MutableMonitoringSummary = {
  scheduled: number;
  ready: number;
  inProgress: number;
  suspended: number;
  completed: number;
  expired: number;
};

function decrementSummaryStatus(summary: MutableMonitoringSummary, status: MonitoringAttemptRecord["status"]): void {
  switch (status) {
    case "scheduled":
      summary.scheduled = Math.max(0, summary.scheduled - 1);
      break;
    case "ready":
      summary.ready = Math.max(0, summary.ready - 1);
      break;
    case "in_progress":
      summary.inProgress = Math.max(0, summary.inProgress - 1);
      break;
    case "suspended":
      summary.suspended = Math.max(0, summary.suspended - 1);
      break;
    case "completed":
      summary.completed = Math.max(0, summary.completed - 1);
      break;
    case "expired":
      summary.expired = Math.max(0, summary.expired - 1);
      break;
  }
}

function incrementSummaryStatus(summary: MutableMonitoringSummary, status: MonitoringAttemptRecord["status"]): void {
  switch (status) {
    case "scheduled":
      summary.scheduled += 1;
      break;
    case "ready":
      summary.ready += 1;
      break;
    case "in_progress":
      summary.inProgress += 1;
      break;
    case "suspended":
      summary.suspended += 1;
      break;
    case "completed":
      summary.completed += 1;
      break;
    case "expired":
      summary.expired += 1;
      break;
  }
}

function buildTimeline(
  diagnosticRecords: readonly DiagnosticLogEntry[],
): readonly MonitoringTimelineEntry[] {
  return diagnosticRecords
    .map(
      (record): MonitoringTimelineDiagnosticEntry => ({
        id: record.id,
        kind: "diagnostic",
        occurredAt: record.occurredAt.toISOString(),
        level: record.level,
        source: record.source,
        operation: record.operation,
        outcome: record.outcome,
        message: sanitizeFreeText(record.message) ?? "",
        details: sanitizeDetails(record.details),
        correlationId: record.correlationId,
      }),
    )
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

function buildResult(
  status: MonitoringAttemptRecord["status"],
  diagnosticRecords: readonly DiagnosticLogEntry[],
): MonitoringAttemptResult | undefined {
  if (status !== "completed" && status !== "expired") {
    return undefined;
  }

  const latestScoreDiagnostic = [...diagnosticRecords]
    .filter(
      (record) =>
        record.operation === "exam_attempt.score.retrieve" && record.outcome === "success",
    )
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];

  const scoreResponse =
    latestScoreDiagnostic?.response && typeof latestScoreDiagnostic.response === "object"
      ? latestScoreDiagnostic.response
      : null;

  if (!scoreResponse) {
    return { status, scoreAvailable: false };
  }

  const scoreAvailable = scoreResponse.scoreAvailable;
  if (scoreAvailable !== true) {
    return { status, scoreAvailable: false };
  }

  return {
    status,
    scoreAvailable: true,
    percentComplete: asNumber(scoreResponse.percentComplete),
    stepsCompleted: asNumber(scoreResponse.stepsCompleted),
    stepsTotal: asNumber(scoreResponse.stepsTotal),
  };
}

function formatCandidateName(attempt: MonitoringAttemptRecord): string {
  const firstName = attempt.candidateFirstName?.trim() ?? "";
  const lastName = attempt.candidateLastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || attempt.candidateEmail;
}

function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}

function compareAttemptsNewestFirst(
  left: MonitoringAttemptRecord,
  right: MonitoringAttemptRecord,
): number {
  const scheduledDiff =
    (right.scheduledFor?.getTime() ?? right.createdAt.getTime()) -
    (left.scheduledFor?.getTime() ?? left.createdAt.getTime());
  if (scheduledDiff !== 0) {
    return scheduledDiff;
  }
  return right.createdAt.getTime() - left.createdAt.getTime();
}

function compareAttemptViewsNewestFirst(
  left: MonitoringAttemptView,
  right: MonitoringAttemptView,
): number {
  const scheduledDiff =
    new Date(right.scheduledFor ?? right.createdAt).getTime() -
    new Date(left.scheduledFor ?? left.createdAt).getTime();
  if (scheduledDiff !== 0) {
    return scheduledDiff;
  }
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

export const DEFAULT_MONITORING_HISTORY_LIMIT = 25;
export const MAX_MONITORING_HISTORY_LIMIT = 100;

function boundMonitoringHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_MONITORING_HISTORY_LIMIT;
  }

  return Math.min(Math.floor(limit), MAX_MONITORING_HISTORY_LIMIT);
}

function boundMonitoringHistoryOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) {
    return 0;
  }

  return Math.floor(offset);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

const SAFE_DETAIL_KEYS = new Set([
  "attemptStatus",
  "currentStatus",
  "expectedStatus",
  "expiredDueTo",
  "trainingId",
  "experienceId",
  "environmentExternalId",
  "participantId",
  "attemptedOperation",
  "integrationSurface",
  "method",
  "path",
  "failureMode",
  "responseStatus",
  "correlationId",
  "scoreAvailable",
  "reason",
  "percentComplete",
  "stepsCompleted",
  "stepsTotal",
]);

function sanitizeDetails(
  details: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!details) {
    return undefined;
  }

  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeFreeText(value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }

  if (looksSensitive(value)) {
    return "[REDACTED]";
  }

  return value;
}

function looksSensitive(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes("loginurl") ||
    lower.includes("sponsored-link") ||
    lower.includes("api key") ||
    lower.includes("apikey") ||
    lower.includes("authorization") ||
    lower.includes("token")
  );
}
