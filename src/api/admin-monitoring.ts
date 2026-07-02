import {
  buildAdminMonitoringView,
  DEFAULT_MONITORING_HISTORY_LIMIT,
  MAX_MONITORING_HISTORY_LIMIT,
  type AdminMonitoringAttemptRepository,
  type AdminMonitoringView,
} from "@/domain/admin-monitoring";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { MAX_DIAGNOSTIC_QUERY_LIMIT, type DiagnosticLogRepository } from "@/domain/diagnostic-log";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import {
  inspectExamAttemptExternalLease,
  reconcileExpiredExamAttemptExternalLease,
  recordExamAttemptExternalLeaseInspectionFailure,
} from "./exam-attempt-external-lease";

export interface AdminMonitoringHandlerDeps {
  readonly attempts: AdminMonitoringAttemptRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly launches?: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly examAttempts?: ExamAttemptRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
  readonly logger: Logger;
}

export interface AdminMonitoringServices {
  readonly adminMonitoringAttempts: AdminMonitoringAttemptRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly labLaunches?: LabLaunchRepository;
  readonly cloudshareConnections?: CloudShareConnectionRepository;
  readonly cloudshareClientFactory?: CloudShareClientFactory;
  readonly examAttempts?: ExamAttemptRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
  readonly logger: Logger;
}

export function buildAdminMonitoringDeps(
  services: AdminMonitoringServices,
): AdminMonitoringHandlerDeps {
  return {
    attempts: services.adminMonitoringAttempts,
    diagnostics: services.diagnostics,
    ...(services.labLaunches ? { launches: services.labLaunches } : {}),
    ...(services.cloudshareConnections ? { connections: services.cloudshareConnections } : {}),
    ...(services.cloudshareClientFactory ? { cloudshare: services.cloudshareClientFactory } : {}),
    ...(services.examAttempts ? { examAttempts: services.examAttempts } : {}),
    ...(services.diagnosticRecorder ? { diagnosticRecorder: services.diagnosticRecorder } : {}),
    logger: services.logger,
  };
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
  const visibleAttemptIds = [...new Set([...currentAttempts, ...history.attempts].map((attempt) => attempt.id))];
  const diagnosticRecords = (
    await Promise.all(
      visibleAttemptIds.map((examAttemptId) =>
        deps.diagnostics.query({
          customerId: request.customerId,
          examAttemptId,
          limit: MAX_DIAGNOSTIC_QUERY_LIMIT,
        }),
      ),
    )
  ).flat();
  const externalLeaseOverrides = await deriveAdminMonitoringExternalLeaseOverrides(
    deps,
    [...currentAttempts, ...history.attempts],
  );

  return {
    status: 200,
    body: {
      monitoring: buildAdminMonitoringView({
        summary,
        currentAttempts,
        history,
        diagnosticRecords,
        externalStatusOverrides: externalLeaseOverrides,
      }),
    },
  };
}

async function deriveAdminMonitoringExternalLeaseOverrides(
  deps: Pick<
    AdminMonitoringHandlerDeps,
    "launches" | "connections" | "cloudshare" | "examAttempts" | "diagnosticRecorder"
  >,
  attempts: readonly {
    readonly id: string;
    readonly customerId: string;
    readonly candidateId: string;
    readonly examId: string;
    readonly status: "scheduled" | "ready" | "in_progress" | "suspended" | "completed" | "expired";
  }[],
): Promise<Record<string, "expired">> {
  const overrides: Record<string, "expired"> = {};
  if (!deps.launches || !deps.connections || !deps.cloudshare) {
    return overrides;
  }

  for (const attempt of attempts) {
    if (
      attempt.status !== "ready" &&
      attempt.status !== "in_progress" &&
      attempt.status !== "suspended"
    ) {
      continue;
    }

    const lease = await inspectExamAttemptExternalLease(
      {
        launches: deps.launches,
        connections: deps.connections,
        cloudshare: deps.cloudshare,
        attempts: deps.examAttempts,
        diagnostics: deps.diagnosticRecorder,
      },
      {
        examAttemptId: attempt.id,
        customerId: attempt.customerId,
      },
    );
    await recordExamAttemptExternalLeaseInspectionFailure(
      { diagnostics: deps.diagnosticRecorder },
      {
        inspection: lease,
        customerId: attempt.customerId,
        examId: attempt.examId,
        candidateId: null,
        candidateEmail: null,
        source: "admin_monitoring",
        actorType: "admin",
        message: "CloudShare external lease inspection failed during admin monitoring reconciliation",
      },
    );
    if (lease.kind === "expired") {
      await reconcileExpiredExamAttemptExternalLease(
        {
          attempts: deps.examAttempts,
          diagnostics: deps.diagnosticRecorder,
        },
        {
          inspection: lease,
          customerId: attempt.customerId,
          examId: attempt.examId,
          candidateId: null,
          candidateEmail: null,
          source: "admin_monitoring",
          actorType: "admin",
          message: "ExamAttempt expired from authoritative CloudShare external lease reconciliation",
        },
      );
      overrides[attempt.id] = "expired";
    }
  }

  return overrides;
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
