import { randomUUID } from "node:crypto";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamClock } from "@/domain/exam-clock";
import type { Exam, ExamRepository } from "@/domain/exam-catalog";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { EventLogRepository } from "@/domain/event-log";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareParticipantLister } from "@/integrations/cloudshare/participants";
import type { Logger } from "@/observability/logger";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";

export interface ExamAttemptDashboardRuntimeDeps {
  readonly repository: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly logger: Logger;
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
  readonly scoreRetrievalEnabled: boolean;
}

export interface CandidateDashboardAttemptItem {
  readonly id: string;
  readonly examId: string;
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

  return {
    status: 200,
    body: {
      exams: exams
        .filter((exam) => exam.status === "published")
        .map(toCandidateDashboardExamItem),
      attempts: reconciledAttempts.map((attempt) => ({
        id: attempt.id,
        examId: attempt.examId,
        scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
        status: attempt.status as CandidateDashboardAttemptItem["status"],
      })),
    },
  };
}

function toCandidateDashboardExamItem(exam: Exam): CandidateDashboardExamItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
  };
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
  const participants = createCloudShareParticipantLister(deps.cloudshare.forConnection(connection));
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
          participants,
        },
        { examAttemptId },
      );
    } catch (error) {
      const diagnostic = {
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
        type: "cloudshare.candidate_dashboard_environment_correlation.failed",
        occurredAt: deps.now?.() ?? new Date(),
        payload: diagnostic,
      });
      deps.logger.warn("candidate dashboard environment correlation failed", diagnostic);
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
