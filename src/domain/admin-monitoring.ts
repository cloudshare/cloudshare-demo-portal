import type { AuditRecord } from "./audit-trail";
import type { EventLogRecord } from "./event-log";
import type { ExamAttemptStatus } from "./exam-attempt";

export interface MonitoringAttemptRecord {
  readonly id: string;
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName: string | null;
  readonly candidateLastName: string | null;
  readonly examId: string;
  readonly examTitle: string;
  readonly status: ExamAttemptStatus;
  readonly scheduledFor: Date | null;
  readonly createdAt: Date;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
  readonly participantId: string | null;
  readonly scoreRetrievalEnabled: boolean;
}

export interface AdminMonitoringAttemptRepository {
  listByCustomerId(customerId: string): Promise<MonitoringAttemptRecord[]>;
}

export interface MonitoringTimelineAuditEntry {
  readonly kind: "audit";
  readonly occurredAt: string;
  readonly action: AuditRecord["action"];
  readonly outcome: AuditRecord["outcome"];
  readonly details?: Record<string, string | number | boolean | null>;
  readonly error?: string;
}

export interface MonitoringTimelineFailureEntry {
  readonly kind: "failure";
  readonly occurredAt: string;
  readonly eventType: string;
  readonly attemptedOperation: string | null;
  readonly integrationSurface: string | null;
  readonly method: string | null;
  readonly path: string | null;
  readonly failureMode: string | null;
  readonly responseStatus: number | null;
  readonly correlationId: string | null;
  readonly error: string | null;
}

export type MonitoringTimelineEntry =
  | MonitoringTimelineAuditEntry
  | MonitoringTimelineFailureEntry;

export interface MonitoringAttemptResult {
  readonly status: "completed" | "expired";
  readonly scoreAvailable: boolean;
  readonly percentComplete?: number;
  readonly stepsCompleted?: number;
  readonly stepsTotal?: number;
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
  readonly summary: {
    readonly scheduled: number;
    readonly ready: number;
    readonly inProgress: number;
    readonly suspended: number;
    readonly completed: number;
    readonly expired: number;
  };
  readonly currentAttempts: {
    readonly scheduled: readonly MonitoringAttemptView[];
    readonly ready: readonly MonitoringAttemptView[];
    readonly inProgress: readonly MonitoringAttemptView[];
    readonly suspended: readonly MonitoringAttemptView[];
  };
  readonly history: readonly MonitoringAttemptView[];
}

export function buildAdminMonitoringView(input: {
  readonly attempts: readonly MonitoringAttemptRecord[];
  readonly auditRecords: readonly AuditRecord[];
  readonly eventLog: readonly EventLogRecord[];
}): AdminMonitoringView {
  const attemptsById = new Set(input.attempts.map((attempt) => attempt.id));
  const auditByAttemptId = groupBy(input.auditRecords, (record) => record.examAttemptId);
  const failureEventsByAttemptId = groupBy(
    input.eventLog.filter((event) => isFailureEventForAttempts(event, attemptsById)),
    (event) => readStringField(event.payload, "examAttemptId")!,
  );

  const attemptViews = [...input.attempts]
    .sort(compareAttemptsNewestFirst)
    .map((attempt) =>
      toAttemptView(
        attempt,
        auditByAttemptId.get(attempt.id) ?? [],
        failureEventsByAttemptId.get(attempt.id) ?? [],
      ),
    );

  return {
    summary: {
      scheduled: countByStatus(input.attempts, "scheduled"),
      ready: countByStatus(input.attempts, "ready"),
      inProgress: countByStatus(input.attempts, "in_progress"),
      suspended: countByStatus(input.attempts, "suspended"),
      completed: countByStatus(input.attempts, "completed"),
      expired: countByStatus(input.attempts, "expired"),
    },
    currentAttempts: {
      scheduled: attemptViews.filter((attempt) => attempt.status === "scheduled"),
      ready: attemptViews.filter((attempt) => attempt.status === "ready"),
      inProgress: attemptViews.filter((attempt) => attempt.status === "in_progress"),
      suspended: attemptViews.filter((attempt) => attempt.status === "suspended"),
    },
    history: attemptViews.filter(
      (attempt) => attempt.status === "completed" || attempt.status === "expired",
    ),
  };
}

function toAttemptView(
  attempt: MonitoringAttemptRecord,
  auditRecords: readonly AuditRecord[],
  failureEvents: readonly EventLogRecord[],
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
    timeline: buildTimeline(auditRecords, failureEvents),
    result: buildResult(attempt.status, auditRecords),
  };
}

function buildTimeline(
  auditRecords: readonly AuditRecord[],
  failureEvents: readonly EventLogRecord[],
): readonly MonitoringTimelineEntry[] {
  return [
    ...auditRecords.map(
      (record): MonitoringTimelineAuditEntry => ({
        kind: "audit",
        occurredAt: record.occurredAt.toISOString(),
        action: record.action,
        outcome: record.outcome,
        details: sanitizeDetails(record.details),
        error: sanitizeFreeText(record.error) ?? undefined,
      }),
    ),
    ...failureEvents.map(
      (event): MonitoringTimelineFailureEntry => ({
        kind: "failure",
        occurredAt: event.occurredAt.toISOString(),
        eventType: event.type,
        attemptedOperation: readStringField(event.payload, "attemptedOperation"),
        integrationSurface: readStringField(event.payload, "integrationSurface"),
        method: readStringField(event.payload, "method") ?? null,
        path: readStringField(event.payload, "path") ?? null,
        failureMode: readStringField(event.payload, "failureMode"),
        responseStatus: readNumberField(event.payload, "responseStatus"),
        correlationId: readStringField(event.payload, "correlationId"),
        error: sanitizeFreeText(readStringField(event.payload, "error")) ?? null,
      }),
    ),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

function buildResult(
  status: MonitoringAttemptRecord["status"],
  auditRecords: readonly AuditRecord[],
): MonitoringAttemptResult | undefined {
  if (status !== "completed" && status !== "expired") {
    return undefined;
  }

  const latestScoreAudit = [...auditRecords]
    .filter((record) => record.action === "score_retrieved" && record.outcome === "success")
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];

  if (!latestScoreAudit?.details) {
    return { status, scoreAvailable: false };
  }

  const scoreAvailable = latestScoreAudit.details.scoreAvailable;
  if (scoreAvailable !== true) {
    return { status, scoreAvailable: false };
  }

  return {
    status,
    scoreAvailable: true,
    percentComplete: asNumber(latestScoreAudit.details.percentComplete),
    stepsCompleted: asNumber(latestScoreAudit.details.stepsCompleted),
    stepsTotal: asNumber(latestScoreAudit.details.stepsTotal),
  };
}

function formatCandidateName(attempt: MonitoringAttemptRecord): string {
  const firstName = attempt.candidateFirstName?.trim() ?? "";
  const lastName = attempt.candidateLastName?.trim() ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || attempt.candidateEmail;
}

function isFailureEventForAttempts(
  event: EventLogRecord,
  attemptIds: ReadonlySet<string>,
): boolean {
  if (!event.type.endsWith(".failed")) {
    return false;
  }

  const examAttemptId = readStringField(event.payload, "examAttemptId");
  return examAttemptId !== null && attemptIds.has(examAttemptId);
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

function countByStatus(
  attempts: readonly MonitoringAttemptRecord[],
  status: MonitoringAttemptRecord["status"],
): number {
  return attempts.filter((attempt) => attempt.status === status).length;
}

function readStringField(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(
  fields: Record<string, unknown>,
  key: string,
): number | null {
  const value = fields[key];
  return typeof value === "number" ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

const SAFE_DETAIL_KEYS = new Set([
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
  details: Record<string, unknown> | undefined,
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
