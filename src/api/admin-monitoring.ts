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
import { MAX_DIAGNOSTIC_QUERY_LIMIT, type DiagnosticLogRepository } from "@/domain/diagnostic-log";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import { inspectExamAttemptExternalLease } from "./exam-attempt-external-lease";

export interface AdminMonitoringHandlerDeps {
  readonly attempts: AdminMonitoringAttemptRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly launches?: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly logger: Logger;
}

export interface AdminMonitoringServices {
  readonly adminMonitoringAttempts: AdminMonitoringAttemptRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly labLaunches?: LabLaunchRepository;
  readonly cloudshareConnections?: CloudShareConnectionRepository;
  readonly cloudshareClientFactory?: CloudShareClientFactory;
  readonly logger: Logger;
}

export function buildAdminMonitoringDeps(
  services: AdminMonitoringServices,
): AdminMonitoringHandlerDeps {
  return {
    attempts: services.adminMonitoringAttempts,
    diagnostics: services.diagnostics,
    launches: services.labLaunches,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
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
  deps: Pick<AdminMonitoringHandlerDeps, "launches" | "connections" | "cloudshare">,
  attempts: readonly {
    readonly id: string;
    readonly customerId: string;
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
      },
      {
        examAttemptId: attempt.id,
        customerId: attempt.customerId,
      },
    );
    if (lease.kind === "expired") {
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
