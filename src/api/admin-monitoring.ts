import {
  buildAdminMonitoringView,
  DEFAULT_MONITORING_HISTORY_LIMIT,
  MAX_MONITORING_HISTORY_LIMIT,
  type AdminMonitoringAttemptRepository,
  type AdminMonitoringView,
} from "@/domain/admin-monitoring";
import type { AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type { Logger } from "@/observability/logger";

export interface AdminMonitoringHandlerDeps {
  readonly attempts: AdminMonitoringAttemptRepository;
  readonly audit: AuditRepository;
  readonly eventLog: EventLogRepository;
  readonly logger: Logger;
}

export interface AdminMonitoringResponse {
  readonly status: number;
  readonly body: AdminMonitoringResponseBody;
}

export interface AdminMonitoringResponseBody {
  readonly monitoring: AdminMonitoringView;
}

export async function handleGetAdminMonitoring(
  deps: AdminMonitoringHandlerDeps,
  request: {
    readonly customerId: string;
    readonly query?: Record<string, string | undefined>;
  },
): Promise<AdminMonitoringResponse> {
  const historyLimit = boundMonitoringHistoryLimit(request.query?.historyLimit);
  const historyOffset = boundMonitoringHistoryOffset(request.query?.historyOffset);

  const [summary, currentAttempts, history] = await Promise.all([
    deps.attempts.countSummaryByCustomerId(request.customerId),
    deps.attempts.listCurrentByCustomerId(request.customerId),
    deps.attempts.listHistoryPageByCustomerId(request.customerId, {
      limit: historyLimit,
      offset: historyOffset,
    }),
  ]);

  const renderedAttemptIds = [...new Set([...currentAttempts, ...history.attempts].map((attempt) => attempt.id))];
  const [auditRecords, eventLog] =
    renderedAttemptIds.length === 0
      ? [[], []]
      : await Promise.all([
          deps.audit.listByExamAttemptIds(renderedAttemptIds),
          deps.eventLog.listFailureEventsByExamAttemptIds(renderedAttemptIds),
        ]);

  return {
    status: 200,
    body: {
      monitoring: buildAdminMonitoringView({
        summary,
        currentAttempts,
        history,
        auditRecords,
        eventLog,
      }),
    },
  };
}

function boundMonitoringHistoryLimit(limit: string | undefined): number {
  if (!limit) {
    return DEFAULT_MONITORING_HISTORY_LIMIT;
  }

  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MONITORING_HISTORY_LIMIT;
  }

  return Math.min(Math.floor(parsed), MAX_MONITORING_HISTORY_LIMIT);
}

function boundMonitoringHistoryOffset(offset: string | undefined): number {
  if (!offset) {
    return 0;
  }

  const parsed = Number.parseInt(offset, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.floor(parsed);
}
