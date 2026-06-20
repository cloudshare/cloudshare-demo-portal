import type { Logger, LogLevel } from "@/observability/logger";
import type { SupportLogRecord, SupportLogRepository } from "@/domain/support-log";
import type { AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type {
  AdminMonitoringAttemptRepository,
  MonitoringAttemptView,
} from "@/domain/admin-monitoring";
import {
  buildAdminMonitoringView,
  buildMonitoringAttemptViews,
} from "@/domain/admin-monitoring";
import type { ExamAttemptStatus } from "@/domain/exam-attempt";

const DEFAULT_ATTEMPT_LIMIT = 50;
const MAX_ATTEMPT_LIMIT = 200;
const WEBHOOK_DIAGNOSTIC_SCAN_LIMIT = 50;
const WEBHOOK_DIAGNOSTIC_RESULT_LIMIT = 20;

export interface SupportWorkbenchRequest {
  readonly customerId: string;
  readonly query: Record<string, string | undefined>;
}

export interface SupportWorkbenchResponse {
  readonly status: number;
  readonly body: {
    summary: {
      readonly scheduled: number;
      readonly ready: number;
      readonly inProgress: number;
      readonly suspended: number;
      readonly completed: number;
      readonly expired: number;
    };
    currentQueues: {
      readonly scheduled: readonly MonitoringAttemptView[];
      readonly ready: readonly MonitoringAttemptView[];
      readonly inProgress: readonly MonitoringAttemptView[];
      readonly suspended: readonly MonitoringAttemptView[];
    };
    matchingAttempts: readonly MonitoringAttemptView[];
    meta: {
      readonly totalMatchingAttempts: number;
      readonly limit: number;
      readonly returnedAttempts: number;
      readonly defaultLimitApplied: boolean;
    };
    diagnostics: SupportWorkbenchDiagnostic[];
  };
}

export interface SupportWorkbenchDiagnostic {
  readonly timestamp: Date;
  readonly level: LogLevel;
  readonly message: string;
  readonly operation: string | null;
  readonly integrationSurface: string | null;
  readonly customerId: string | null;
  readonly webhookPathToken: string | null;
  readonly method: string | null;
  readonly path: string | null;
  readonly requestBodyBytes: number | null;
  readonly rawBodySha256: string | null;
  readonly signaturePresent: boolean | null;
  readonly rawRequestBody: string | null;
  readonly trustGateReason: string | null;
}

export interface SupportWorkbenchDeps {
  readonly attempts: AdminMonitoringAttemptRepository;
  readonly audit: AuditRepository;
  readonly eventLog: EventLogRepository;
  readonly supportLog: SupportLogRepository;
  readonly logger: Logger;
}

export async function handleGetSupportWorkbench(
  deps: SupportWorkbenchDeps,
  request: SupportWorkbenchRequest,
): Promise<SupportWorkbenchResponse> {
  const filters = parseFilters(request.query);
  const attempts = await deps.attempts.listByCustomerId(request.customerId);
  const filteredAttempts = attempts.filter((attempt) => matchesAttemptFilters(attempt, filters));
  const filteredAttemptIds = new Set(filteredAttempts.map((attempt) => attempt.id));
  const auditRecords = (await deps.audit.listAll()).filter((record) =>
    filteredAttemptIds.has(record.examAttemptId),
  );
  const eventLog = (await deps.eventLog.listAll()).filter((event) => {
    const examAttemptId = event.payload.examAttemptId;
    return typeof examAttemptId === "string" && filteredAttemptIds.has(examAttemptId);
  });
  const monitoringInput = {
    attempts: filteredAttempts,
    auditRecords,
    eventLog,
  };
  const monitoringView = buildAdminMonitoringView(monitoringInput);
  const matchingAttemptViews = buildMonitoringAttemptViews(monitoringInput);
  const diagnostics = (await deps.supportLog.listAll(WEBHOOK_DIAGNOSTIC_SCAN_LIMIT))
    .filter(isCloudShareWebhookDiagnostic)
    .map(toSupportWorkbenchDiagnostic)
    .slice(0, WEBHOOK_DIAGNOSTIC_RESULT_LIMIT);
  const boundedAttempts = matchingAttemptViews.slice(0, filters.limit);

  return {
    status: 200,
    body: {
      summary: monitoringView.summary,
      currentQueues: monitoringView.currentAttempts,
      matchingAttempts: boundedAttempts,
      meta: {
        totalMatchingAttempts: matchingAttemptViews.length,
        limit: filters.limit,
        returnedAttempts: boundedAttempts.length,
        defaultLimitApplied: filters.defaultLimitApplied,
      },
      diagnostics,
    },
  };
}

interface SupportWorkbenchFilters {
  readonly candidateQuery: string | null;
  readonly examId: string | null;
  readonly status: ExamAttemptStatus | null;
  readonly scheduledFrom: number | null;
  readonly scheduledTo: number | null;
  readonly limit: number;
  readonly defaultLimitApplied: boolean;
}

function parseFilters(query: Record<string, string | undefined>): SupportWorkbenchFilters {
  const candidateQuery = normalizeText(query.candidate);
  const examId = normalizeText(query.examId);
  const status = parseStatus(query.status);
  const scheduledFrom = parseDate(query.scheduledFrom);
  const scheduledTo = parseDate(query.scheduledTo);
  const parsedLimit = query.limit ? Number.parseInt(query.limit, 10) : Number.NaN;
  const hasExplicitLimit = Number.isFinite(parsedLimit) && parsedLimit > 0;
  const limit = hasExplicitLimit
    ? Math.min(parsedLimit, MAX_ATTEMPT_LIMIT)
    : DEFAULT_ATTEMPT_LIMIT;

  return {
    candidateQuery,
    examId,
    status,
    scheduledFrom,
    scheduledTo,
    limit,
    defaultLimitApplied: !hasExplicitLimit,
  };
}

function parseStatus(value: string | undefined): ExamAttemptStatus | null {
  switch (value) {
    case "booked":
    case "scheduled":
    case "ready":
    case "in_progress":
    case "suspended":
    case "completed":
    case "expired":
      return value;
    default:
      return null;
  }
}

function parseDate(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function matchesAttemptFilters(
  attempt: Awaited<ReturnType<AdminMonitoringAttemptRepository["listByCustomerId"]>>[number],
  filters: SupportWorkbenchFilters,
): boolean {
  if (filters.candidateQuery) {
    const candidateText = normalizeText(
      [
        attempt.candidateEmail,
        attempt.candidateFirstName,
        attempt.candidateLastName,
        `${attempt.candidateFirstName ?? ""} ${attempt.candidateLastName ?? ""}`.trim(),
      ]
        .filter(Boolean)
        .join(" "),
    );
    if (!candidateText?.includes(filters.candidateQuery)) {
      return false;
    }
  }

  if (filters.examId && attempt.examId !== filters.examId) {
    return false;
  }

  if (filters.status && attempt.status !== filters.status) {
    return false;
  }

  const scheduledTime = attempt.scheduledFor?.getTime() ?? null;
  if (filters.scheduledFrom !== null && (scheduledTime === null || scheduledTime < filters.scheduledFrom)) {
    return false;
  }

  if (filters.scheduledTo !== null && (scheduledTime === null || scheduledTime > filters.scheduledTo)) {
    return false;
  }

  return true;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isCloudShareWebhookDiagnostic(record: SupportLogRecord): boolean {
  return (
    readStringField(record.fields, "operation") === "receive_webhook" &&
    readStringField(record.fields, "integrationSurface") === "cloudshare.v3.webhook"
  );
}

function toSupportWorkbenchDiagnostic(record: SupportLogRecord): SupportWorkbenchDiagnostic {
  const message = record.message;
  const isUnknownTarget = message === "cloudshare webhook rejected: unknown webhook target";

  return {
    timestamp: record.timestamp,
    level: record.level,
    message,
    operation: readStringField(record.fields, "operation"),
    integrationSurface: readStringField(record.fields, "integrationSurface"),
    customerId: readStringField(record.fields, "customerId"),
    webhookPathToken: readStringField(record.fields, "webhookPathToken"),
    method: readStringField(record.fields, "method"),
    path: readStringField(record.fields, "path"),
    requestBodyBytes: readNumberField(record.fields, "requestBodyBytes"),
    rawBodySha256: readStringField(record.fields, "rawBodySha256"),
    signaturePresent: readBooleanField(record.fields, "signaturePresent"),
    rawRequestBody: isUnknownTarget ? null : readStringField(record.fields, "rawRequestBody"),
    trustGateReason: readStringField(record.fields, "trustGateReason"),
  };
}

function readStringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" ? value : null;
}

function readBooleanField(fields: Record<string, unknown>, key: string): boolean | null {
  const value = fields[key];
  return typeof value === "boolean" ? value : null;
}
