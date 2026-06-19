import {
  buildAdminMonitoringView,
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
  request: { readonly customerId: string },
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

  return {
    status: 200,
    body: {
      monitoring: buildAdminMonitoringView({
        attempts,
        auditRecords,
        eventLog,
      }),
    },
  };
}
