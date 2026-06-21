import { randomUUID } from "node:crypto";
import { resolveExamAttemptScore, type ScoreRetrievalProvider } from "@/domain/score-result";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { AuditRepository } from "@/domain/audit-trail";
import type { CloudShareConnectionRecord, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { ParticipantLister } from "@/domain/environment-correlation";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import { LabLaunchNotFoundError, ScoreRetrievalError } from "@/domain/errors";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";

export interface ScoreHandlerDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams: ExamRepository;
  readonly launches: LabLaunchRepository;
  readonly audit: AuditRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly createScoreRetriever: (
    connection: CloudShareConnectionRecord,
  ) => ScoreRetrievalProvider;
  readonly createParticipantLister: (
    connection: CloudShareConnectionRecord,
  ) => ParticipantLister;
  readonly logger: Logger;
  readonly limitations: readonly string[];
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
  readonly diagnostics?: DiagnosticRecorder;
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

  const anchors = {
    source: "runtime" as const,
    customerId: attempt.customerId ?? null,
    candidateEmail: null as string | null,
    examId: attempt.examId ?? null,
    examAttemptId: attempt.id,
    actor: { type: "candidate" as const, id: attempt.candidateId, email: null as string | null },
    subject: { type: "exam_attempt" as const, id: attempt.id },
  };

  const exam = await deps.exams.findById(attempt.examId);
  if (!exam || exam.customerId !== request.session.customerId) {
    return { status: 404, body: { error: "exam not found for attempt" } };
  }

  const launch = await deps.launches.findByExamAttemptId(examAttemptId);
  if (!launch) {
    return { status: 404, body: { error: "no lab launch found for exam attempt" } };
  }

  if (!exam.scoreRetrievalEnabled) {
    const body = {
      examAttemptId,
      experienceId: launch.experienceId,
      scoreRetrievalEnabled: false,
      scoreAvailable: false,
      reason: "score_retrieval_disabled" as const,
      message: "Guided Journey scoring is not enabled for this Exam.",
      retrievedAt: (deps.now ?? (() => new Date()))().toISOString(),
      limitations: [...deps.limitations],
    };
    await deps.audit.write({
      id: `${examAttemptId}:score_retrieved:${body.retrievedAt}`,
      examAttemptId,
      candidateId: request.session.userId,
      action: "score_retrieved",
      outcome: "success",
      details: {
        experienceId: launch.experienceId,
        scoreAvailable: false,
        reason: body.reason,
      },
      occurredAt: new Date(body.retrievedAt),
    });
    return {
      status: 200,
      body,
    };
  }

  const connection = await deps.connections.findByCustomerId(request.session.customerId);
  if (!connection) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = {
      correlationId,
      examAttemptId,
      customerId: request.session.customerId,
      operation: "candidate_score_retrieval",
      attemptedOperation: "load_customer_cloudshare_connection",
      integrationSurface: "cloudshare.connection",
      failureMode: "missing_customer_connection",
    };
    await writeScoreFailureAudit(
      deps,
      examAttemptId,
      request.session.userId,
      launch.experienceId,
      correlationId,
      diagnostic,
      "Score retrieval failed.",
    );
    deps.logger.warn("candidate score retrieval failed", diagnostic);
    return {
      status: 502,
      body: {
        error: "score retrieval failed",
        correlationId,
      },
    };
  }

  try {
    const resolvedParticipantId = await resolveLaunchParticipantId(
      deps,
      connection,
      request.session.customerId,
      request.session.userId,
      examAttemptId,
      launch,
    );
    if (!resolvedParticipantId.ok) {
      await deps.diagnostics?.record({
        ...anchors,
        level: "warn",
        operation: "exam_attempt.score.correlate_environment",
        outcome: "failure",
        message: "Score retrieval failed: could not correlate CloudShare environment participant",
      });
      return resolvedParticipantId.response;
    }

    await deps.diagnostics?.record({
      ...anchors,
      level: "info",
      operation: "exam_attempt.score.correlate_environment",
      outcome: "success",
      message: "CloudShare environment participant resolved for score retrieval",
      externalIds: {
        ...(launch.experienceId ? { experienceId: launch.experienceId } : {}),
        participantId: resolvedParticipantId.participantId,
      },
    });

    const scoreRetriever = deps.createScoreRetriever(connection);
    const result = await resolveExamAttemptScore(
      {
        scoreRetriever,
        now: deps.now,
      },
      {
        examAttemptId,
        experienceId: launch.experienceId,
        participantId: resolvedParticipantId.participantId,
        scoreRetrievalEnabled: true,
      },
    );

    if (!result.scoreAvailable) {
      await deps.audit.write({
        id: `${examAttemptId}:score_retrieved:${result.retrievedAt}`,
        examAttemptId,
        candidateId: request.session.userId,
        action: "score_retrieved",
        outcome: "success",
        details: {
          experienceId: result.experienceId,
          scoreAvailable: false,
          reason: result.reason,
        },
        occurredAt: new Date(result.retrievedAt),
      });
      await deps.diagnostics?.record({
        ...anchors,
        level: "info",
        operation: "exam_attempt.score.retrieve",
        outcome: "success",
        message: "Score retrieved — no score available yet",
        response: { scoreAvailable: false, reason: result.reason },
      });
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

    await deps.audit.write({
      id: `${examAttemptId}:score_retrieved:${result.retrievedAt}`,
      examAttemptId,
      candidateId: request.session.userId,
      action: "score_retrieved",
      outcome: "success",
      details: {
        experienceId: result.experienceId,
        scoreAvailable: true,
        percentComplete: result.percentComplete,
        stepsCompleted: result.stepsCompleted,
        stepsTotal: result.stepsTotal,
      },
      occurredAt: new Date(result.retrievedAt),
    });

    await deps.diagnostics?.record({
      ...anchors,
      level: "info",
      operation: "exam_attempt.score.retrieve",
      outcome: "success",
      message: "Score retrieved successfully",
      response: {
        scoreAvailable: true,
        percentComplete: result.percentComplete,
        stepsCompleted: result.stepsCompleted,
        stepsTotal: result.stepsTotal,
      },
    });

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
        exploredRate: result.exploredRate,
        inProgressRate: result.inProgressRate,
        notStartedRate: result.notStartedRate,
        passedRate: result.passedRate,
        failedRate: result.failedRate,
        notInitiatedRate: result.notInitiatedRate,
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
      const diagnostic = buildScoreRetrievalDiagnostic(
        correlationId,
        examAttemptId,
        launch.experienceId,
        launch.participantId ?? "unknown-participant",
        error,
      );
      await deps.audit.write({
        id: `${examAttemptId}:score_retrieved_failed:${correlationId}`,
        examAttemptId,
        candidateId: request.session.userId,
        action: "score_retrieved",
        outcome: "failure",
        details: {
          experienceId: launch.experienceId,
          attemptedOperation: diagnostic.attemptedOperation,
          integrationSurface: diagnostic.integrationSurface,
          method: diagnostic.method,
          path: diagnostic.path,
          failureMode: diagnostic.failureMode,
          responseStatus: diagnostic.responseStatus,
          correlationId,
        },
        error: "Score retrieval failed.",
        occurredAt: deps.now?.() ?? new Date(),
      });
      await deps.diagnostics?.record({
        ...anchors,
        level: "warn",
        operation: "exam_attempt.score.retrieve",
        outcome: "failure",
        message: "Score retrieval failed",
        details: {
          attemptedOperation: asString(diagnostic.attemptedOperation),
          integrationSurface: asString(diagnostic.integrationSurface),
          failureMode: asString(diagnostic.failureMode),
          correlationId,
        },
      });
      deps.logger.warn("candidate score retrieval failed", diagnostic);
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

async function resolveLaunchParticipantId(
  deps: ScoreHandlerDeps,
  connection: CloudShareConnectionRecord,
  customerId: string,
  candidateId: string,
  examAttemptId: string,
  launch: NonNullable<Awaited<ReturnType<LabLaunchRepository["findByExamAttemptId"]>>>,
): Promise<
  | { ok: true; participantId: string }
  | { ok: false; response: ScoreResponse }
> {
  if (launch.participantId) {
    return { ok: true, participantId: launch.participantId };
  }

  if (!launch.trainingId || !launch.participantEmail) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = {
      correlationId,
      customerId,
      examAttemptId,
      experienceId: launch.experienceId,
      trainingId: launch.trainingId ?? null,
      participantEmail: launch.participantEmail ?? null,
      operation: "candidate_score_retrieval",
      attemptedOperation: "resolve_training_participant",
      integrationSurface: "cloudshare.v4.training.participant_list",
      method: "GET",
      path: launch.trainingId
        ? `/v4/trainings/${launch.trainingId}/students`
        : "/v4/trainings/{trainingId}/students",
      failureMode: "missing_participant_id",
      error: "CloudShare participantId is not recorded for this lab launch.",
    };
    await writeScoreFailureAudit(
      deps,
      examAttemptId,
      candidateId,
      launch.experienceId,
      correlationId,
      diagnostic,
      "Score retrieval failed.",
    );
    deps.logger.warn("candidate score retrieval failed", diagnostic);
    return {
      ok: false,
      response: {
        status: 502,
        body: { error: "score retrieval failed", correlationId },
      },
    };
  }

  try {
    const participants = deps.createParticipantLister(connection);
    await correlateEnvironmentForExamAttempt(
      {
        launches: deps.launches,
        participants,
      },
      { examAttemptId },
    );
  } catch (error) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = buildParticipantResolutionDiagnostic(
      correlationId,
      customerId,
      examAttemptId,
      launch,
      error,
    );
    await writeScoreFailureAudit(
      deps,
      examAttemptId,
      candidateId,
      launch.experienceId,
      correlationId,
      diagnostic,
      "Score retrieval failed.",
    );
    deps.logger.warn("candidate score retrieval failed", diagnostic);
    return {
      ok: false,
      response: {
        status: 502,
        body: { error: "score retrieval failed", correlationId },
      },
    };
  }

  const refreshedLaunch = await deps.launches.findByExamAttemptId(examAttemptId);
  if (refreshedLaunch?.participantId) {
    return { ok: true, participantId: refreshedLaunch.participantId };
  }

  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const diagnostic = buildParticipantResolutionDiagnostic(
    correlationId,
    customerId,
    examAttemptId,
    launch,
    "missing_participant_id",
  );
  await writeScoreFailureAudit(
    deps,
    examAttemptId,
    candidateId,
    launch.experienceId,
    correlationId,
    diagnostic,
    "Score retrieval failed.",
  );
  deps.logger.warn("candidate score retrieval failed", diagnostic);
  return {
    ok: false,
    response: {
      status: 502,
      body: { error: "score retrieval failed", correlationId },
    },
  };
}

function buildScoreRetrievalDiagnostic(
  correlationId: string,
  examAttemptId: string,
  experienceId: string,
  participantId: string,
  error: ScoreRetrievalError,
): Record<string, unknown> {
  const cause = error.context?.cause;
  const path = `/guided-journey/progress/${experienceId}/${participantId}`;
  const base = {
    correlationId,
    examAttemptId,
    experienceId,
    participantId,
    operation: "candidate_score_retrieval",
    attemptedOperation: "get_guided_journey_progress",
    integrationSurface: "cloudshare.v4.guided_journey.progress",
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

function buildParticipantResolutionDiagnostic(
  correlationId: string,
  customerId: string,
  examAttemptId: string,
  launch: {
    readonly experienceId: string;
    readonly trainingId?: string;
    readonly participantEmail?: string;
  },
  error: unknown,
): Record<string, unknown> {
  const base = {
    correlationId,
    customerId,
    examAttemptId,
    experienceId: launch.experienceId,
    trainingId: launch.trainingId ?? null,
    participantEmail: launch.participantEmail ?? null,
    operation: "candidate_score_retrieval",
    attemptedOperation: "resolve_training_participant",
    integrationSurface: "cloudshare.v4.training.participant_list",
    method: "GET",
    path: launch.trainingId
      ? `/v4/trainings/${launch.trainingId}/students`
      : "/v4/trainings/{trainingId}/students",
  };

  if (error === "missing_participant_id") {
    return {
      ...base,
      failureMode: "missing_participant_id",
      error: "CloudShare participantId could not be resolved from training participants.",
    };
  }

  if (
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError
  ) {
    return toCloudShareDiagnostic(base, error);
  }

  return {
    ...base,
    failureMode: "unknown",
    error: error instanceof Error ? error.message : String(error),
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

async function writeScoreFailureAudit(
  deps: Pick<ScoreHandlerDeps, "audit" | "now">,
  examAttemptId: string,
  candidateId: string,
  experienceId: string,
  correlationId: string,
  diagnostic: Record<string, unknown>,
  error: string,
): Promise<void> {
  await deps.audit.write({
    id: `${examAttemptId}:score_retrieved_failed:${correlationId}`,
    examAttemptId,
    candidateId,
    action: "score_retrieved",
    outcome: "failure",
    details: {
      experienceId,
      attemptedOperation: asString(diagnostic.attemptedOperation),
      integrationSurface: asString(diagnostic.integrationSurface),
      method: asString(diagnostic.method),
      path: asString(diagnostic.path),
      failureMode: asString(diagnostic.failureMode),
      responseStatus: asNumber(diagnostic.responseStatus),
      correlationId,
    },
    error,
    occurredAt: deps.now?.() ?? new Date(),
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
