import { MAX_DIAGNOSTIC_QUERY_LIMIT, type DiagnosticLogEntry, type DiagnosticLogRepository } from "@/domain/diagnostic-log";
import type {
  AdminExamAttemptDiagnosticContextRecord,
  AdminExamAttemptDiagnosticContextRepository,
} from "@/domain/admin-exam-attempt-diagnostics";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EnvironmentRepository } from "@/domain/environment";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import type { Logger } from "@/observability/logger";

export interface AdminExamAttemptDiagnosticDrilldownHandlerDeps {
  readonly contexts: AdminExamAttemptDiagnosticContextRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
  readonly refreshEnvironmentStatus?: (
    context: AdminExamAttemptDiagnosticContextRecord,
  ) => Promise<void>;
}

export interface AdminExamAttemptDiagnosticDrilldownServices {
  readonly adminExamAttemptDiagnosticContexts: AdminExamAttemptDiagnosticContextRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly environments: EnvironmentRepository;
  readonly diagnosticRecorder: DiagnosticRecorder;
}

export interface AdminExamAttemptDiagnosticDrilldownResponse {
  readonly status: number;
  readonly body: {
    readonly drilldown?: ExamAttemptDiagnosticDrilldownReadModel;
    readonly error?: string;
  };
}

export interface ExamAttemptDiagnosticDrilldownReadModel {
  readonly timelineSource: "diagnostic_log_entry";
  readonly timelinePage: {
    readonly limit: number;
    readonly returned: number;
    readonly hasMore: boolean;
  };
  readonly candidate: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
  };
  readonly exam: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly scoreRetrievalEnabled: boolean;
  };
  readonly attempt: {
    readonly id: string;
    readonly status: string;
    readonly scheduledFor: string | null;
    readonly createdAt: string;
  };
  readonly cloudShare: {
    readonly trainingId: string | null;
    readonly experienceId: string | null;
    readonly environmentExternalId: string | null;
    readonly environmentId: string | null;
    readonly participantId: string | null;
    readonly participantEmail: string | null;
  };
  readonly timeline: readonly ExamAttemptDiagnosticTimelineEntry[];
}

export interface ExamAttemptDiagnosticTimelineEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly level: DiagnosticLogEntry["level"];
  readonly source: string;
  readonly operation: string;
  readonly outcome: DiagnosticLogEntry["outcome"];
  readonly message: string;
  readonly integrationSurface: string | null;
  readonly correlationId: string | null;
  readonly candidateEmail: string | null;
  readonly examId: string | null;
  readonly examAttemptId: string | null;
  readonly externalIds: Readonly<Record<string, string>> | null;
  readonly request: Readonly<Record<string, unknown>> | null;
  readonly response: Readonly<Record<string, unknown>> | null;
  readonly details: Readonly<Record<string, unknown>> | null;
  readonly requestResponseSummary: string;
}

export function buildAdminExamAttemptDiagnosticDrilldownDeps(
  services: AdminExamAttemptDiagnosticDrilldownServices,
): AdminExamAttemptDiagnosticDrilldownHandlerDeps {
  return {
    contexts: services.adminExamAttemptDiagnosticContexts,
    diagnostics: services.diagnostics,
    logger: services.logger,
    refreshEnvironmentStatus: (context) =>
      refreshCloudShareEnvironmentStatus(services, context),
  };
}

export async function refreshCloudShareEnvironmentStatus(
  services: Pick<
    AdminExamAttemptDiagnosticDrilldownServices,
    "cloudshareConnections" | "cloudshareClientFactory" | "environments" | "diagnosticRecorder"
  >,
  context: AdminExamAttemptDiagnosticContextRecord,
): Promise<void> {
  const environmentExternalId = context.environmentExternalId ?? context.environmentId;
  if (!environmentExternalId) {
    return;
  }

  const connection = await services.cloudshareConnections.findByCustomerId(context.customerId);
  if (!connection) {
    await services.diagnosticRecorder.record({
      source: "admin-diagnostics",
      level: "warn",
      operation: "cloudshare.environment.reconcile",
      outcome: "failure",
      customerId: context.customerId,
      candidateEmail: context.candidateEmail,
      examId: context.examId,
      examAttemptId: context.attemptId,
      message: "CloudShare environment status refresh skipped: missing CloudShare Connection",
      externalIds: { environmentExternalId },
      details: {
        integrationSurface: "cloudshare.v3.env",
        refreshedBy: "admin_exam_attempt_diagnostics",
        reason: "missing_cloudshare_connection",
      },
    });
    return;
  }

  const source = createCloudShareEnvironmentSource(
    services.cloudshareClientFactory.forConnection(connection),
  );
  const snapshot = await source.getEnvironmentState(environmentExternalId);
  const observedAt = new Date();
  if (snapshot) {
    await services.environments.save({
      environmentExternalId,
      status: snapshot.status,
      observedAt,
    });
  }

  await services.diagnosticRecorder.record({
    source: "admin-diagnostics",
    operation: "cloudshare.environment.reconcile",
    outcome: "success",
    customerId: context.customerId,
    candidateEmail: context.candidateEmail,
    examId: context.examId,
    examAttemptId: context.attemptId,
    actor: { type: "admin", id: null, email: null },
    subject: { type: "exam_attempt", id: context.attemptId },
    message: snapshot
      ? "CloudShare environment status refreshed"
      : "CloudShare environment status refresh found no environment",
    externalIds: {
      environmentExternalId,
      ...(snapshot?.status ? { environmentStatus: snapshot.status } : {}),
    },
    request: {
      method: "GET",
      path: "/api/v3/envs/{envId}",
    },
    response: {
      status: snapshot ? 200 : 404,
      body: snapshot ? { status: snapshot.status } : null,
    },
    details: {
      integrationSurface: "cloudshare.v3.env",
      refreshedBy: "admin_exam_attempt_diagnostics",
      observedAt: observedAt.toISOString(),
    },
  });
}

export async function handleGetAdminExamAttemptDiagnosticDrilldown(
  deps: AdminExamAttemptDiagnosticDrilldownHandlerDeps,
  request: { readonly customerId: string; readonly examAttemptId: string },
): Promise<AdminExamAttemptDiagnosticDrilldownResponse> {
  const examAttemptId = request.examAttemptId.trim();
  const context = await deps.contexts.findByExamAttemptId(request.customerId, examAttemptId);
  if (!context) {
    return {
      status: 404,
      body: {
        error: `ExamAttempt ${examAttemptId} was not found for customer ${request.customerId}`,
      },
    };
  }

  if (context.environmentExternalId || context.environmentId) {
    try {
      await deps.refreshEnvironmentStatus?.(context);
    } catch (error) {
      deps.logger.warn("admin exam attempt environment status refresh failed", {
        customerId: request.customerId,
        examAttemptId,
        environmentExternalId: context.environmentExternalId,
        environmentId: context.environmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const timeline = (await deps.diagnostics.query({
    customerId: request.customerId,
    examAttemptId,
    limit: MAX_DIAGNOSTIC_QUERY_LIMIT,
  }))
    .slice()
    .reverse()
    .map(toTimelineEntry);
  const hasMore =
    (
      await deps.diagnostics.query({
        customerId: request.customerId,
        examAttemptId,
        limit: 1,
        offset: MAX_DIAGNOSTIC_QUERY_LIMIT,
      })
    ).length > 0;

  return {
    status: 200,
    body: {
      drilldown: {
        timelineSource: "diagnostic_log_entry",
        timelinePage: {
          limit: MAX_DIAGNOSTIC_QUERY_LIMIT,
          returned: timeline.length,
          hasMore,
        },
        candidate: {
          id: context.candidateId,
          email: context.candidateEmail,
          firstName: context.candidateFirstName,
          lastName: context.candidateLastName,
        },
        exam: {
          id: context.examId,
          title: context.examTitle,
          status: context.examStatus,
          scoreRetrievalEnabled: context.scoreRetrievalEnabled,
        },
        attempt: {
          id: context.attemptId,
          status: context.attemptStatus,
          scheduledFor: context.scheduledFor?.toISOString() ?? null,
          createdAt: context.createdAt.toISOString(),
        },
        cloudShare: {
          trainingId: context.trainingId,
          experienceId: context.experienceId,
          environmentExternalId: context.environmentExternalId,
          environmentId: context.environmentId,
          participantId: context.participantId,
          participantEmail: context.participantEmail,
        },
        timeline,
      },
    },
  };
}

function toTimelineEntry(entry: DiagnosticLogEntry): ExamAttemptDiagnosticTimelineEntry {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    level: entry.level,
    source: entry.source,
    operation: entry.operation,
    outcome: entry.outcome,
    message: entry.message,
    integrationSurface:
      typeof entry.details?.integrationSurface === "string"
        ? entry.details.integrationSurface
        : null,
    correlationId: entry.correlationId,
    candidateEmail: entry.candidateEmail,
    examId: entry.examId,
    examAttemptId: entry.examAttemptId,
    externalIds: entry.externalIds,
    request: entry.request,
    response: entry.response,
    details: entry.details,
    requestResponseSummary: summariseRequestResponse(entry),
  };
}

function summariseRequestResponse(entry: DiagnosticLogEntry): string {
  const method = typeof entry.request?.method === "string" ? entry.request.method : null;
  const path = typeof entry.request?.path === "string" ? entry.request.path : null;
  const status =
    typeof entry.response?.status === "number"
      ? `HTTP ${entry.response.status}`
      : typeof entry.response?.status === "string"
        ? `HTTP ${entry.response.status}`
        : null;

  const base = [method, path].filter((value): value is string => value !== null).join(" ");
  if (base && status) {
    return `${base} -> ${status}`;
  }
  if (base) {
    return base;
  }
  if (status) {
    return status;
  }
  return "Unavailable";
}
