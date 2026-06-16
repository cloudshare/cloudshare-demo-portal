import { randomUUID } from "node:crypto";
import { resolveExamAttemptScore, type ScoreRetrievalProvider } from "@/domain/score-result";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { CloudShareConnectionRecord, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import { LabLaunchNotFoundError, ScoreRetrievalError } from "@/domain/errors";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";

export interface ScoreHandlerDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams: ExamRepository;
  readonly launches: LabLaunchRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly createScoreRetriever: (
    connection: CloudShareConnectionRecord,
  ) => ScoreRetrievalProvider;
  readonly logger: Logger;
  readonly limitations: readonly string[];
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

export interface ScoreRequest {
  readonly query: Record<string, string | undefined>;
  readonly session:
    | {
        readonly userId: string;
        readonly customerId: string;
        readonly role: string;
      }
    | null;
}

export interface ScoreResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleGetCandidateScore(
  deps: ScoreHandlerDeps,
  request: ScoreRequest,
): Promise<ScoreResponse> {
  if (!request.session || request.session.role !== "candidate") {
    return { status: 401, body: { error: "unauthorized" } };
  }

  const examAttemptId = request.query.examAttemptId?.trim();
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  const attempt = await deps.attempts.findById(examAttemptId);
  if (
    !attempt ||
    attempt.candidateId !== request.session.userId ||
    (attempt.customerId && attempt.customerId !== request.session.customerId)
  ) {
    return { status: 403, body: { error: "forbidden" } };
  }

  if (attempt.status !== "completed") {
    return {
      status: 409,
      body: { error: "score is only available after the exam attempt is completed" },
    };
  }

  const exam = await deps.exams.findById(attempt.examId);
  if (!exam || exam.customerId !== request.session.customerId) {
    return { status: 404, body: { error: "exam not found for attempt" } };
  }

  const launch = await deps.launches.findByExamAttemptId(examAttemptId);
  if (!launch) {
    return { status: 404, body: { error: "no lab launch found for exam attempt" } };
  }

  if (!exam.scoreRetrievalEnabled) {
    return {
      status: 200,
      body: {
        examAttemptId,
        experienceId: launch.experienceId,
        scoreRetrievalEnabled: false,
        scoreAvailable: false,
        reason: "score_retrieval_disabled",
        message: "Guided Journey scoring is not enabled for this Exam.",
        retrievedAt: (deps.now ?? (() => new Date()))().toISOString(),
        limitations: [...deps.limitations],
      },
    };
  }

  const connection = await deps.connections.findByCustomerId(request.session.customerId);
  if (!connection) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    deps.logger.warn("candidate score retrieval failed", {
      correlationId,
      examAttemptId,
      customerId: request.session.customerId,
      operation: "candidate_score_retrieval",
      attemptedOperation: "load_customer_cloudshare_connection",
      integrationSurface: "cloudshare.connection",
      failureMode: "missing_customer_connection",
    });
    return {
      status: 502,
      body: {
        error: "score retrieval failed",
        correlationId,
      },
    };
  }

  try {
    const scoreRetriever = deps.createScoreRetriever(connection);
    const result = await resolveExamAttemptScore(
      {
        scoreRetriever,
        now: deps.now,
      },
      {
        examAttemptId,
        experienceId: launch.experienceId,
        scoreRetrievalEnabled: true,
      },
    );

    if (!result.scoreAvailable) {
      return {
        status: 200,
        body: {
          examAttemptId: result.examAttemptId,
          experienceId: result.experienceId,
          scoreRetrievalEnabled: true,
          scoreAvailable: false,
          reason: result.reason,
          message: "No Guided Journey score is available for this Exam attempt.",
          retrievedAt: result.retrievedAt,
          limitations: [...deps.limitations],
        },
      };
    }

    return {
      status: 200,
      body: {
        examAttemptId: result.examAttemptId,
        experienceId: result.experienceId,
        scoreRetrievalEnabled: true,
        scoreAvailable: true,
        percentComplete: result.percentComplete,
        stepsCompleted: result.stepsCompleted,
        stepsTotal: result.stepsTotal,
        steps: result.steps,
        retrievedAt: result.retrievedAt,
        limitations: [...deps.limitations],
      },
    };
  } catch (error) {
    if (error instanceof LabLaunchNotFoundError) {
      return { status: 404, body: { error: "no lab launch found for exam attempt" } };
    }
    if (error instanceof ScoreRetrievalError) {
      const correlationId = (deps.newCorrelationId ?? randomUUID)();
      deps.logger.warn(
        "candidate score retrieval failed",
        buildScoreRetrievalDiagnostic(correlationId, examAttemptId, launch.experienceId, error),
      );
      return {
        status: 502,
        body: {
          error: "score retrieval failed",
          correlationId,
        },
      };
    }

    deps.logger.error("candidate score retrieval errored", {
      examAttemptId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: "internal error" } };
  }
}

function buildScoreRetrievalDiagnostic(
  correlationId: string,
  examAttemptId: string,
  experienceId: string,
  error: ScoreRetrievalError,
): Record<string, unknown> {
  const cause = error.context?.cause;
  const path = `/experiences/${experienceId}/journey/participants`;
  const base = {
    correlationId,
    examAttemptId,
    experienceId,
    operation: "candidate_score_retrieval",
    attemptedOperation: "get_guided_journey_participants",
    integrationSurface: "cloudshare.v4.guided_journey.participants",
    method: "GET",
    path,
  };

  if (
    cause instanceof CloudShareRequestError ||
    cause instanceof CloudShareTransportError ||
    cause instanceof CloudShareResponseError
  ) {
    return toCloudShareDiagnostic(base, cause);
  }

  return {
    ...base,
    failureMode: "unknown",
    error: error.message,
    cause: typeof cause === "string" ? cause : String(cause),
  };
}

function toCloudShareDiagnostic(
  base: Record<string, unknown>,
  cause: CloudShareRequestError | CloudShareTransportError | CloudShareResponseError,
): Record<string, unknown> {
  const shared = {
    ...base,
    method: cause.context?.method ?? base.method,
    path: cause.context?.path ?? base.path,
    host: cause.context?.host,
    integrationSurface: cause.context?.integrationSurface ?? base.integrationSurface,
    requestHeaders: cause.context?.requestHeaders,
    requestBody: cause.context?.requestBody,
  };

  if (cause instanceof CloudShareRequestError) {
    return {
      ...shared,
      failureMode: "http_status",
      responseStatus: cause.status,
      responseHeaders: cause.context?.responseHeaders,
      responseBody: cause.context?.responseBody,
      network: cause.context?.network,
      tls: cause.context?.tls,
    };
  }

  if (cause instanceof CloudShareTransportError) {
    return {
      ...shared,
      failureMode: "transport",
      cause: cause.context?.cause,
    };
  }

  return {
    ...shared,
    failureMode: "unexpected_response",
    responseHeaders: cause.context?.responseHeaders,
    responseBody: cause.context?.responseBody,
    network: cause.context?.network,
    tls: cause.context?.tls,
    issues: cause.context?.issues,
  };
}
