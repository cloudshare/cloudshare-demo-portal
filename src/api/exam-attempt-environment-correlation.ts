import { randomUUID } from "node:crypto";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { projectEventLogMetadata, type EventLogRepository } from "@/domain/event-log";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import type { Logger } from "@/observability/logger";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import { createCloudShareTrainingDelivery } from "@/integrations/cloudshare/training-delivery";
import { projectCloudShareGenericLogValue } from "@/integrations/cloudshare/diagnostic-redaction";
import { projectCloudShareFailureContext } from "@/integrations/cloudshare/diagnostic-failure-projection";
import { projectProtectedCloudShareExchange } from "./protected-cloudshare-exchange";
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";
import type { CloudShareWorkflowSequenceAllocator } from "@/ports/cloudshare-observation";

export interface EnsureExamAttemptEnvironmentCorrelationDeps {
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly logger: Logger;
  readonly eventLog?: EventLogRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

export interface ExamAttemptEnvironmentCorrelationResult {
  readonly actionableEnvironmentId: string | null;
}

export async function ensureExamAttemptEnvironmentCorrelation(
  deps: EnsureExamAttemptEnvironmentCorrelationDeps,
  input: {
    readonly examAttemptId: string;
    readonly operation:
      | "exam_suspend"
      | "exam_resume"
      | "exam_complete"
      | "heartbeat_auto_suspend";
    readonly correlationId?: string;
    readonly sequenceAllocator?: CloudShareWorkflowSequenceAllocator;
  },
): Promise<ExamAttemptEnvironmentCorrelationResult> {
  const attempt = await deps.attempts.findById(input.examAttemptId);
  if (!attempt?.customerId) {
    return { actionableEnvironmentId: null };
  }

  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch?.trainingId || !launch.participantEmail) {
    return { actionableEnvironmentId: null };
  }

  const connection = await deps.connections.findByCustomerId(attempt.customerId);
  if (!connection) {
    return { actionableEnvironmentId: null };
  }

  const correlationId = input.correlationId ?? (deps.newCorrelationId ?? randomUUID)();
  try {
    const result = await correlateEnvironmentForExamAttempt(
      {
        launches: deps.launches,
        participants: createCloudShareTrainingDelivery(deps.cloudshare.forConnection(connection, certificationCloudShareWorkflow({
          actor: { type: "system", id: input.operation }, customerId: attempt.customerId,
          subject: { type: "exam_attempt", id: input.examAttemptId }, correlationId,
          source: "candidate-portal", examAttemptId: input.examAttemptId,
          ...(input.sequenceAllocator ? { sequenceAllocator: input.sequenceAllocator } : {}),
          candidateEmail: launch.participantEmail, externalIds: { trainingId: launch.trainingId },
        }))),
      },
      { examAttemptId: input.examAttemptId },
    );
    return {
      actionableEnvironmentId: result.correlated ? result.environmentId : null,
    };
  } catch (error) {
    const diagnostic: Record<string, unknown> = {
      correlationId,
      customerId: attempt.customerId,
      examAttemptId: input.examAttemptId,
      trainingId: launch.trainingId,
      operation: input.operation,
      attemptedOperation: "list_training_participants",
      ...toCloudShareFailureDiagnostic({
        cause: error,
        integrationSurface: "cloudshare.v4.training.participant_list",
        method: "GET",
        path: `/v4/trainings/${launch.trainingId}/students`,
      }),
    };

    await deps.eventLog?.append({
      eventId: correlationId,
      customerId: attempt.customerId,
      correlationId,
      type: `cloudshare.${input.operation}.environment_correlation.failed`,
      occurredAt: deps.now?.() ?? new Date(),
      payload: projectEventLogMetadata({
        ...diagnostic,
        operation: input.operation,
        outcome: "failure",
        actor: { type: "candidate", id: attempt.candidateId },
        externalIds: {
          examAttemptId: input.examAttemptId,
          examId: attempt.examId,
          trainingId: launch.trainingId,
        },
      }),
    });
    const protectedExchange = projectProtectedCloudShareExchange(diagnostic);
    await deps.diagnostics?.record({
      level: "warn",
      source: "exam-attempt-environment-correlation",
      operation: input.operation,
      outcome: "failure",
      customerId: attempt.customerId,
      actor: { type: "candidate", id: attempt.candidateId },
      subject: { type: "exam_attempt", id: input.examAttemptId },
      message: "CloudShare environment correlation failed",
      correlationId,
      examId: attempt.examId,
      examAttemptId: input.examAttemptId,
      externalIds: { trainingId: launch.trainingId },
      request: protectedExchange.request,
      response: protectedExchange.response,
      details: {
        attemptedOperation: "list_training_participants",
        integrationSurface: diagnostic["integrationSurface"],
        failureMode: diagnostic["failureMode"],
        ...(typeof diagnostic["responseStatus"] === "number" ? { responseStatus: diagnostic["responseStatus"] } : {}),
        ...(protectedExchange.transport ? { transport: protectedExchange.transport } : {}),
      },
    });
    deps.logger.warn(`${input.operation} environment correlation failed`, projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>);
    return { actionableEnvironmentId: null };
  }
}

function toCloudShareFailureDiagnostic(input: {
  readonly cause: unknown;
  readonly integrationSurface: string;
  readonly method: string;
  readonly path: string;
}): Record<string, unknown> {
  const base = {
    integrationSurface: input.integrationSurface,
    method: input.method,
    path: input.path,
  };

  const rawContext = (input.cause as { context?: Record<string, unknown> } | null)?.context;
  const rawProjection = projectCloudShareFailureContext(rawContext);
  const cause = asCloudShareError(input.cause);
  const rateLimited = isCloudShareRateLimitError(cause);
  const context = cause?.context ?? rawContext;
  if (rawProjection?.request === null && rawProjection.response === null) {
    return {
      ...base,
      method: context?.method ?? base.method,
      path: context?.path ?? base.path,
      integrationSurface: context?.integrationSurface ?? base.integrationSurface,
      failureMode: rateLimited ? cause.classification ?? "rate_limit" : "http_status",
      responseStatus: typeof (cause as { status?: unknown } | null)?.status === "number" ? (cause as unknown as { status: number }).status : context?.status,
    };
  }
  if (rateLimited || cause instanceof CloudShareRequestError || cause?.name === "CloudShareRequestError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: rateLimited ? cause.classification ?? "rate_limit" : "http_status",
      responseStatus:
        rateLimited || cause instanceof CloudShareRequestError ? cause.status : cause?.context?.status,
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
      network: cause?.context?.network,
      tls: cause?.context?.tls,
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
  if (isCloudShareRateLimitError(error)) {
    return error;
  }

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
