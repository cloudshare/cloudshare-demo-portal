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
}): AdminMonitoringView {
  const visibleAttempts = [...input.currentAttempts, ...input.history.attempts];
  const diagnosticsByAttemptId = groupBy(
    input.diagnosticRecords.filter(
      (record): record is DiagnosticLogEntry & { examAttemptId: string } =>
        typeof record.examAttemptId === "string" && record.examAttemptId.length > 0,
    ),
    (record) => record.examAttemptId,
  );

  const currentAttemptViews = [...input.currentAttempts]
    .sort(compareAttemptsNewestFirst)
    .map((attempt) =>
      toAttemptView(
        attempt,
        diagnosticsByAttemptId.get(attempt.id) ?? [],
      ),
    );
  const historyAttemptViews = [...input.history.attempts]
    .sort(compareAttemptsNewestFirst)
    .map((attempt) =>
      toAttemptView(
        attempt,
        diagnosticsByAttemptId.get(attempt.id) ?? [],
      ),
    );
  const historyOffset = boundMonitoringHistoryOffset(input.history.offset);
  const historyLimit = boundMonitoringHistoryLimit(input.history.limit);
  const hasMore = historyOffset + historyAttemptViews.length < input.history.total;

  return {
    summary: input.summary,
    currentAttempts: {
      scheduled: currentAttemptViews.filter((attempt) => attempt.status === "scheduled"),
      ready: currentAttemptViews.filter((attempt) => attempt.status === "ready"),
      inProgress: currentAttemptViews.filter((attempt) => attempt.status === "in_progress"),
      suspended: currentAttemptViews.filter((attempt) => attempt.status === "suspended"),
    },
    history: historyAttemptViews,
    historyPage: {
      limit: historyLimit,
      offset: historyOffset,
      returned: historyAttemptViews.length,
      total: input.history.total,
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
