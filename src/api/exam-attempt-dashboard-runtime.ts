import { randomUUID } from "node:crypto";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamClock } from "@/domain/exam-clock";
import {
  isCohortExamSessionDeliveryAvailable,
  isIndividualExamDeliveryAvailable,
  type Exam,
  type ExamRepository,
} from "@/domain/exam-catalog";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import { projectEventLogMetadata, type EventLogRepository } from "@/domain/event-log";
import type { CohortExamSessionRepository } from "@/domain/cohort-exam-session";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareTrainingDelivery } from "@/integrations/cloudshare/training-delivery";
import { projectCloudShareGenericLogValue } from "@/integrations/cloudshare/diagnostic-redaction";
import type { Logger } from "@/observability/logger";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";
import { projectProtectedCloudShareExchange } from "./protected-cloudshare-exchange";
import {
  inspectExamAttemptExternalLease,
  reconcileExpiredExamAttemptExternalLease,
  recordExamAttemptExternalLeaseInspectionFailure,
} from "./exam-attempt-external-lease";

export interface ExamAttemptDashboardRuntimeDeps {
  readonly repository: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly logger: Logger;
  readonly cohortSessions?: CohortExamSessionRepository;
  readonly clocks?: ExamClock;
  readonly launches?: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly eventLog?: EventLogRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

export interface ExamAttemptDashboardRuntimeRequest {
  readonly customerId: string;
  readonly candidateId: string;
}

export interface ExamAttemptDashboardRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface CandidateDashboardExamItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly individualSchedulingEnabled: boolean;
  readonly availableCohortSessions: readonly CandidateDashboardCohortSessionItem[];
}

export interface CandidateDashboardCohortSessionItem {
  readonly id: string;
  readonly name: string;
  readonly admissionStartsAt: string;
  readonly admissionEndsAt: string | null;
}

export interface CandidateDashboardAttemptItem {
  readonly id: string;
  readonly examId: string;
  readonly cohortSessionId: string | null;
  readonly examTitle: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly scheduledFor: string | null;
  readonly status:
    | "scheduled"
    | "ready"
    | "in_progress"
    | "suspended"
    | "completed"
    | "expired";
}

export async function getExamAttemptDashboardRuntime(
  deps: ExamAttemptDashboardRuntimeDeps,
  request: ExamAttemptDashboardRuntimeRequest,
): Promise<ExamAttemptDashboardRuntimeResponse> {
  const exams = await deps.repository.listByCustomerId(request.customerId);
  const attempts = await deps.attempts.listByCandidate(request.candidateId);
  const availableCohortSessionsByExamId = await listAvailableCohortSessionsByExamId(
    deps,
    request.customerId,
  );

  for (const attempt of attempts) {
    const completion = await reconcileExamAttemptCompletion(
      {
        attempts: deps.attempts,
        exams: deps.repository,
        clocks: deps.clocks,
      },
      { examAttemptId: attempt.id },
    );
    if (completion?.changed && completion.status === "completed") {
      const refreshedAttempt = await deps.attempts.findById(attempt.id);
      if (refreshedAttempt) {
        await recordExamAttemptCompletionDiagnostic(
          deps.diagnostics,
          refreshedAttempt,
          null,
        );
      }
    }
  }

  const reconciledAttempts = await deps.attempts.listByCandidate(request.candidateId);
  await correlateCandidateAttemptEnvironments(
    deps,
    request.customerId,
    reconciledAttempts.map((attempt) => attempt.id),
  );
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const externalLeaseOverrides = await deriveExternalLeaseStatusOverrides(
    deps,
    reconciledAttempts,
    examsById,
  );

  return {
    status: 200,
    body: {
      exams: exams
        .filter((exam) =>
          exam.status === "published" &&
          (isIndividualExamDeliveryAvailable(exam) ||
            (isCohortExamSessionDeliveryAvailable(exam) &&
              (availableCohortSessionsByExamId.get(exam.id)?.length ?? 0) > 0)),
        )
        .map((exam) =>
          toCandidateDashboardExamItem(exam, availableCohortSessionsByExamId.get(exam.id) ?? []),
        ),
      attempts: reconciledAttempts.map((attempt) => {
        const exam = examsById.get(attempt.examId);
        return {
          id: attempt.id,
          examId: attempt.examId,
          cohortSessionId: attempt.cohortSessionId ?? null,
          examTitle: exam?.title ?? attempt.examId,
          timeLimitMinutes: exam?.timeLimitMinutes ?? 0,
          storageLeaseMinutes: exam?.storageLeaseMinutes ?? null,
          openPeriodMinutes: exam?.openPeriodMinutes ?? 0,
          scoreRetrievalEnabled: exam?.scoreRetrievalEnabled ?? false,
          scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
          status:
            externalLeaseOverrides.get(attempt.id) ??
            (attempt.status as CandidateDashboardAttemptItem["status"]),
        };
      }),
    },
  };
}

async function deriveExternalLeaseStatusOverrides(
  deps: ExamAttemptDashboardRuntimeDeps,
  attempts: readonly {
    readonly id: string;
    readonly customerId?: string;
    readonly candidateId: string;
    readonly examId: string;
    readonly status: string;
    readonly scheduledFor?: Date | null;
  }[],
  examsById: ReadonlyMap<string, Exam>,
): Promise<Map<string, CandidateDashboardAttemptItem["status"]>> {
  const overrides = new Map<string, CandidateDashboardAttemptItem["status"]>();
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
    const exam = examsById.get(attempt.examId);
    if (!hasAuthoredOpenPeriodClosed(attempt.scheduledFor ?? null, exam, deps.now)) {
      continue;
    }

    const lease = await inspectExamAttemptExternalLease(
      {
        launches: deps.launches,
        connections: deps.connections,
        cloudshare: deps.cloudshare,
        attempts: deps.attempts,
        diagnostics: deps.diagnostics,
        now: deps.now,
      },
      {
        examAttemptId: attempt.id,
        customerId: attempt.customerId ?? null,
      },
    );
    await recordExamAttemptExternalLeaseInspectionFailure(deps, {
      inspection: lease,
      customerId: attempt.customerId ?? null,
      examId: attempt.examId,
      candidateId: null,
      candidateEmail: null,
      source: "candidate_dashboard",
      actorType: "system",
      message: "CloudShare external lease inspection failed during candidate dashboard reconciliation",
    });
    if (lease.kind === "expired") {
      await reconcileExpiredExamAttemptExternalLease(
        {
          attempts: deps.attempts,
          diagnostics: deps.diagnostics,
        },
        {
          inspection: lease,
          customerId: attempt.customerId ?? null,
          examId: attempt.examId,
          candidateId: null,
          candidateEmail: null,
          source: "candidate_dashboard",
          actorType: "system",
          message: "ExamAttempt expired from authoritative CloudShare external lease reconciliation",
        },
      );
      overrides.set(attempt.id, "expired");
    }
  }

  return overrides;
}

function hasAuthoredOpenPeriodClosed(
  scheduledFor: Date | null,
  exam: Pick<Exam, "openPeriodMinutes"> | undefined,
  now: (() => Date) | undefined,
): boolean {
  if (!scheduledFor || !exam) {
    return false;
  }

  const openPeriodEndsAt = scheduledFor.getTime() + exam.openPeriodMinutes * 60_000;
  return (now ?? (() => new Date()))().getTime() >= openPeriodEndsAt;
}

function toCandidateDashboardExamItem(
  exam: Exam,
  availableCohortSessions: readonly CandidateDashboardCohortSessionItem[],
): CandidateDashboardExamItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
    storageLeaseMinutes: exam.storageLeaseMinutes ?? null,
    openPeriodMinutes: exam.openPeriodMinutes,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
    individualSchedulingEnabled: isIndividualExamDeliveryAvailable(exam),
    availableCohortSessions,
  };
}

async function listAvailableCohortSessionsByExamId(
  deps: Pick<ExamAttemptDashboardRuntimeDeps, "cohortSessions" | "repository" | "now">,
  customerId: string,
): Promise<Map<string, CandidateDashboardCohortSessionItem[]>> {
  const byExamId = new Map<string, CandidateDashboardCohortSessionItem[]>();
  if (!deps.cohortSessions) {
    return byExamId;
  }

  const now = (deps.now ?? (() => new Date()))();
  const exams = await deps.repository.listByCustomerId(customerId);
  for (const exam of exams) {
    const sessions = await deps.cohortSessions.listByExamId(exam.id);
    if (!isCohortExamSessionDeliveryAvailable(exam)) {
      continue;
    }
    const available = sessions
      .filter(
        (session) =>
          session.customerId === customerId &&
          session.status === "published" &&
          session.admissionStartsAt.getTime() <= now.getTime() &&
          (!session.admissionEndsAt || session.admissionEndsAt.getTime() > now.getTime()),
      )
      .sort((left, right) => left.admissionStartsAt.getTime() - right.admissionStartsAt.getTime())
      .map((session) => ({
        id: session.id,
        name: session.name,
        admissionStartsAt: session.admissionStartsAt.toISOString(),
        admissionEndsAt: session.admissionEndsAt?.toISOString() ?? null,
      }));
    if (available.length > 0) {
      byExamId.set(exam.id, available);
    }
  }

  return byExamId;
}

async function correlateCandidateAttemptEnvironments(
  deps: ExamAttemptDashboardRuntimeDeps,
  customerId: string,
  examAttemptIds: readonly string[],
): Promise<void> {
  if (!deps.launches || !deps.connections || !deps.cloudshare || examAttemptIds.length === 0) {
    return;
  }

  const connection = await deps.connections.findByCustomerId(customerId);
  if (!connection) {
    return;
  }

  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const trainingDelivery = createCloudShareTrainingDelivery(deps.cloudshare.forConnection(connection));
  for (const examAttemptId of examAttemptIds) {
    const launch = await deps.launches.findByExamAttemptId(examAttemptId);
    const trainingId = launch?.trainingId;
    const path = trainingId
      ? `/v4/trainings/${trainingId}/students`
      : "/v4/trainings/{trainingId}/students";

    try {
      await correlateEnvironmentForExamAttempt(
        {
          launches: deps.launches,
        participants: trainingDelivery,
        },
        { examAttemptId },
      );
    } catch (error) {
      const diagnostic: Record<string, unknown> = {
        correlationId,
        customerId,
        examAttemptId,
        trainingId,
        operation: "candidate_dashboard_environment_correlation",
        attemptedOperation: "list_training_participants",
        ...toCloudShareFailureDiagnostic({
          attemptedOperation: "list_training_participants",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path,
          cause: error,
        }),
      };
      await deps.eventLog?.append({
        eventId: correlationId,
        customerId,
        correlationId,
        type: "cloudshare.candidate_dashboard_environment_correlation.failed",
        occurredAt: deps.now?.() ?? new Date(),
        payload: projectEventLogMetadata({
          ...diagnostic,
          operation: "candidate_dashboard_environment_correlation",
          outcome: "failure",
          actor: { type: "candidate" },
          externalIds: {
            examAttemptId,
            ...(trainingId ? { trainingId } : {}),
          },
        }),
      });
      const protectedExchange = projectProtectedCloudShareExchange(diagnostic);
      await deps.diagnostics?.record({
        level: "warn",
        source: "exam-attempt-dashboard-runtime",
        operation: "candidate_dashboard_environment_correlation",
        outcome: "failure",
        customerId,
        actor: { type: "candidate" },
        subject: { type: "exam_attempt", id: examAttemptId },
        message: "CloudShare environment correlation failed during candidate dashboard reconciliation",
        correlationId,
        examAttemptId,
        externalIds: trainingId ? { trainingId } : null,
        request: protectedExchange.request,
        response: protectedExchange.response,
        details: {
          attemptedOperation: "list_training_participants",
          integrationSurface: "cloudshare.v4.training.participant_list",
          failureMode: diagnostic["failureMode"],
        },
      });
      deps.logger.warn("candidate dashboard environment correlation failed", projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>);
    }
  }
}

function toCloudShareFailureDiagnostic(input: {
  readonly attemptedOperation: string;
  readonly integrationSurface: string;
  readonly method: string;
  readonly path: string;
  readonly cause: unknown;
}): Record<string, unknown> {
  const base = {
    attemptedOperation: input.attemptedOperation,
    integrationSurface: input.integrationSurface,
    method: input.method,
    path: input.path,
  };

  const cause = asCloudShareError(input.cause);
  if (cause instanceof CloudShareRequestError || cause?.name === "CloudShareRequestError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "http_status",
      responseStatus:
        cause instanceof CloudShareRequestError ? cause.status : cause?.context?.status,
      requestHeaders: cause?.context?.requestHeaders,
      requestQuery: cause?.context?.requestQuery,
      requestBody: cause?.context?.requestBody,
      responseHeaders: cause?.context?.responseHeaders,
      responseBody: cause?.context?.responseBody,
      network: cause?.context?.network,
      tls: cause?.context?.tls,
    };
  }
  if (cause instanceof CloudShareTransportError || cause?.name === "CloudShareTransportError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "transport",
      requestHeaders: cause?.context?.requestHeaders,
      requestQuery: cause?.context?.requestQuery,
      requestBody: cause?.context?.requestBody,
      cause: cause?.context?.cause,
    };
  }
  if (cause instanceof CloudShareResponseError || cause?.name === "CloudShareResponseError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "unexpected_response",
      requestHeaders: cause?.context?.requestHeaders,
      requestQuery: cause?.context?.requestQuery,
      requestBody: cause?.context?.requestBody,
      responseHeaders: cause?.context?.responseHeaders,
      responseBody: cause?.context?.responseBody,
      network: cause?.context?.network,
      tls: cause?.context?.tls,
      issues: cause?.context?.issues,
    };
  }
  return {
    ...base,
    failureMode: "unknown",
    error: input.cause instanceof Error ? input.cause.message : String(input.cause),
  };
}

function asCloudShareError(error: unknown): CloudShareError | null {
  if (
    error instanceof CloudShareError ||
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError
  ) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string" &&
    ((error as { name: string }).name === "CloudShareError" ||
      (error as { name: string }).name === "CloudShareRequestError" ||
      (error as { name: string }).name === "CloudShareTransportError" ||
      (error as { name: string }).name === "CloudShareResponseError")
  ) {
    return error as CloudShareError;
  }

  return null;
}
