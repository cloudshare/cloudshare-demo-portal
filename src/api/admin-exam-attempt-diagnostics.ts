import { MAX_DIAGNOSTIC_QUERY_LIMIT, type DiagnosticLogEntry, type DiagnosticLogRepository } from "@/domain/diagnostic-log";
import type {
  AdminExamAttemptDiagnosticContextRecord,
  AdminExamAttemptDiagnosticContextRepository,
} from "@/domain/admin-exam-attempt-diagnostics";
import type { Logger } from "@/observability/logger";

export interface AdminExamAttemptDiagnosticDrilldownHandlerDeps {
  readonly contexts: AdminExamAttemptDiagnosticContextRepository;
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
  readonly refreshEnvironmentStatus?: (
    context: AdminExamAttemptDiagnosticContextRecord,
  ) => Promise<void>;
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
