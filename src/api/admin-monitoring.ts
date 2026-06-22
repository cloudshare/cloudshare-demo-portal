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
  const attempts = await deps.attempts.listByCustomerId(request.customerId);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  const auditRecords = (await deps.audit.listAll()).filter((record) =>
    attemptIds.has(record.examAttemptId),
  );
  const eventLog = (await deps.eventLog.listAll()).filter((event) => {
    const examAttemptId = event.payload.examAttemptId;
    return typeof examAttemptId === "string" && attemptIds.has(examAttemptId);
  });
  const historyLimit = boundMonitoringHistoryLimit(request.query?.historyLimit);
  const historyOffset = boundMonitoringHistoryOffset(request.query?.historyOffset);

  return {
    status: 200,
    body: {
      monitoring: buildAdminMonitoringView({
        attempts,
        auditRecords,
        eventLog,
        historyPage: {
          limit: historyLimit,
          offset: historyOffset,
        },
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
