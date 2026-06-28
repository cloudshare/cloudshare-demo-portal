import { randomUUID } from "node:crypto";
import {
  resolveExamAttemptScore,
  type DiagnosticScoreRetrievalProvider,
  type ParticipantProgressDiagnostics,
  type ScoreRetrievalProvider,
} from "@/domain/score-result";
import type { ExamAttempt } from "@/domain/exam-attempt";
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
import { redactCloudShareAdminSupportValue } from "@/integrations/cloudshare/diagnostic-redaction";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";

export interface ExamAttemptScoreRuntimeDeps {
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

export interface ExamAttemptScoreRuntimeRequest {
  readonly attempt: ExamAttempt;
  readonly customerId: string;
}

export interface ExamAttemptScoreRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

type ScoreMetadata = {
  readonly examTitle: string;
  readonly scheduledFor: string | null;
};

export async function getExamAttemptScoreRuntime(
  deps: ExamAttemptScoreRuntimeDeps,
  request: ExamAttemptScoreRuntimeRequest,
): Promise<ExamAttemptScoreRuntimeResponse> {
  const { attempt } = request;
  const examAttemptId = attempt.id;
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
  if (!exam || exam.customerId !== request.customerId) {
    return { status: 404, body: { error: "exam not found for attempt" } };
  }

  const metadata: ScoreMetadata = {
    examTitle: exam.title,
    scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
  };

  const launch = await deps.launches.findByExamAttemptId(examAttemptId);
  if (!launch) {
    return { status: 404, body: { error: "no lab launch found for exam attempt" } };
  }

  if (!exam.scoreRetrievalEnabled) {
    const body = {
      examAttemptId,
      ...metadata,
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
      candidateId: attempt.candidateId,
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

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = {
      correlationId,
      examAttemptId,
      customerId: request.customerId,
      operation: "candidate_score_retrieval",
      attemptedOperation: "load_customer_cloudshare_connection",
      integrationSurface: "cloudshare.connection",
      failureMode: "missing_customer_connection",
    };
    await writeScoreFailureAudit(
      deps,
      examAttemptId,
      attempt.candidateId,
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
      request.customerId,
      attempt.candidateId,
      examAttemptId,
      launch,
    );
    if (!resolvedParticipantId.ok) {
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
    const scoreRetrieval = await getScoreProgressForDiagnostics(
      scoreRetriever,
      examAttemptId,
      launch.experienceId,
      resolvedParticipantId.participantId,
    );
    const result = await resolveExamAttemptScore(
      {
        scoreRetriever: scoreRetrieval
          ? {
              getParticipantProgress: async () => scoreRetrieval.progress,
            }
          : scoreRetriever,
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
        candidateId: attempt.candidateId,
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
        ...(scoreRetrieval
          ? {
              request: { ...scoreRetrieval.request },
              response: scoreRetrieval.response ? { ...scoreRetrieval.response } : null,
            }
          : {
              response: { scoreAvailable: false, reason: result.reason },
            }),
      });
      return {
        status: 200,
        body: {
          examAttemptId: result.examAttemptId,
          ...metadata,
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
      candidateId: attempt.candidateId,
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
      ...(scoreRetrieval
        ? {
            request: { ...scoreRetrieval.request },
            response: scoreRetrieval.response ? { ...scoreRetrieval.response } : null,
          }
        : {
            response: {
              scoreAvailable: true,
              percentComplete: result.percentComplete,
              stepsCompleted: result.stepsCompleted,
              stepsTotal: result.stepsTotal,
            },
          }),
    });

    return {
      status: 200,
      body: {
        examAttemptId: result.examAttemptId,
        ...metadata,
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
        request.customerId,
        examAttemptId,
        launch.experienceId,
        launch.participantId ?? "unknown-participant",
        error,
      );
      await deps.audit.write({
        id: `${examAttemptId}:score_retrieved_failed:${correlationId}`,
        examAttemptId,
        candidateId: attempt.candidateId,
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
        request: diagnosticRequestFields(diagnostic),
        response: diagnosticResponseFields(diagnostic),
        details: {
          attemptedOperation: asString(diagnostic.attemptedOperation),
          integrationSurface: asString(diagnostic.integrationSurface),
          method: asString(diagnostic.method),
          path: asString(diagnostic.path),
          failureMode: asString(diagnostic.failureMode),
          responseStatus: asNumber(diagnostic.responseStatus),
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
      customerId: attempt.customerId ?? request.customerId,
      examId: attempt.examId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, body: { error: "internal error" } };
  }
}

async function resolveLaunchParticipantId(
  deps: ExamAttemptScoreRuntimeDeps,
  connection: CloudShareConnectionRecord,
  customerId: string,
  candidateId: string,
  examAttemptId: string,
  launch: NonNullable<Awaited<ReturnType<LabLaunchRepository["findByExamAttemptId"]>>>,
): Promise<
  | { ok: true; participantId: string }
  | { ok: false; response: ExamAttemptScoreRuntimeResponse }
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
    await deps.diagnostics?.record({
      ...scoreDiagnosticAnchors(examAttemptId, customerId, candidateId, launch, correlationId),
      level: "warn",
      operation: "exam_attempt.score.correlate_environment",
      outcome: "failure",
      message: "Score retrieval failed: could not correlate CloudShare environment participant",
      externalIds: scoreCorrelationExternalIds(launch),
      details: toSupportDetailFields(diagnostic),
    });
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
    await deps.diagnostics?.record({
      ...scoreDiagnosticAnchors(examAttemptId, customerId, candidateId, launch, correlationId),
      level: "warn",
      operation: "exam_attempt.score.correlate_environment",
      outcome: "failure",
      message: "Score retrieval failed: could not correlate CloudShare environment participant",
      externalIds: scoreCorrelationExternalIds(launch),
      details: toSupportDetailFields(diagnostic),
    });
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
  await deps.diagnostics?.record({
    ...scoreDiagnosticAnchors(examAttemptId, customerId, candidateId, launch, correlationId),
    level: "warn",
    operation: "exam_attempt.score.correlate_environment",
    outcome: "failure",
    message: "Score retrieval failed: could not correlate CloudShare environment participant",
    externalIds: scoreCorrelationExternalIds(launch),
    details: toSupportDetailFields(diagnostic),
  });
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
  customerId: string,
  examAttemptId: string,
  experienceId: string,
  participantId: string,
  error: ScoreRetrievalError,
): Record<string, unknown> {
  const cause = error.context?.cause;
  const path = `/guided-journey/progress/${experienceId}/${participantId}`;
  const base = {
    correlationId,
    customerId,
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
    requestHeaders: redactDiagnosticSupportValue(cause.context?.requestHeaders),
    requestBody: redactDiagnosticSupportValue(cause.context?.requestBody),
  };

  if (cause instanceof CloudShareRequestError) {
    return {
      ...shared,
      failureMode: "http_status",
      responseStatus: cause.status,
      responseHeaders: redactDiagnosticSupportValue(cause.context?.responseHeaders),
      responseBody: redactDiagnosticSupportValue(cause.context?.responseBody),
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
    responseHeaders: redactDiagnosticSupportValue(cause.context?.responseHeaders),
    responseBody: redactDiagnosticSupportValue(cause.context?.responseBody),
    network: cause.context?.network,
    tls: cause.context?.tls,
    issues: cause.context?.issues,
  };
}

async function writeScoreFailureAudit(
  deps: Pick<ExamAttemptScoreRuntimeDeps, "audit" | "now">,
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

async function getScoreProgressForDiagnostics(
  scoreRetriever: ScoreRetrievalProvider,
  examAttemptId: string,
  experienceId: string,
  participantId: string,
): Promise<ParticipantProgressDiagnostics | null> {
  if (!hasDiagnosticScoreRetrieval(scoreRetriever)) {
    return null;
  }

  try {
    return await scoreRetriever.getParticipantProgressForDiagnostics(experienceId, participantId);
  } catch (cause) {
    throw new ScoreRetrievalError("Failed to retrieve Guided Journey progress", {
      examAttemptId,
      experienceId,
      cause,
      causeMessage: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function hasDiagnosticScoreRetrieval(
  scoreRetriever: ScoreRetrievalProvider,
): scoreRetriever is DiagnosticScoreRetrievalProvider {
  return "getParticipantProgressForDiagnostics" in scoreRetriever &&
    typeof scoreRetriever.getParticipantProgressForDiagnostics === "function";
}

function redactDiagnosticSupportValue(value: unknown): unknown {
  return redactCloudShareAdminSupportValue(value);
}

function scoreDiagnosticAnchors(
  examAttemptId: string,
  customerId: string,
  candidateId: string,
  launch: {
    readonly experienceId: string;
    readonly participantEmail?: string;
  },
  correlationId?: string,
) {
  return {
    source: "runtime" as const,
    customerId,
    candidateEmail: launch.participantEmail ?? null,
    examAttemptId,
    correlationId: correlationId ?? null,
    actor: { type: "candidate" as const, id: candidateId, email: launch.participantEmail ?? null },
    subject: { type: "exam_attempt" as const, id: examAttemptId },
  };
}

function scoreCorrelationExternalIds(launch: {
  readonly experienceId: string;
  readonly trainingId?: string;
}): Record<string, string> {
  return {
    experienceId: launch.experienceId,
    ...(launch.trainingId ? { trainingId: launch.trainingId } : {}),
  };
}

function toSupportDetailFields(
  diagnostic: Record<string, unknown>,
): Record<string, unknown> {
  return {
    attemptedOperation: asString(diagnostic.attemptedOperation),
    integrationSurface: asString(diagnostic.integrationSurface),
    method: asString(diagnostic.method),
    path: asString(diagnostic.path),
    failureMode: asString(diagnostic.failureMode),
    responseStatus: asNumber(diagnostic.responseStatus),
    correlationId: asString(diagnostic.correlationId),
    error: asString(diagnostic.error),
    host: asString(diagnostic.host),
    network: redactDiagnosticSupportValue(diagnostic.network),
    tls: redactDiagnosticSupportValue(diagnostic.tls),
    cause: redactDiagnosticSupportValue(diagnostic.cause),
    issues: redactDiagnosticSupportValue(diagnostic.issues),
    requestHeaders: redactDiagnosticSupportValue(diagnostic.requestHeaders),
    requestBody: redactDiagnosticSupportValue(diagnostic.requestBody),
    responseHeaders: redactDiagnosticSupportValue(diagnostic.responseHeaders),
    responseBody: redactDiagnosticSupportValue(diagnostic.responseBody),
    trainingId: asString(diagnostic.trainingId),
    participantEmail: asString(diagnostic.participantEmail),
  };
}

function diagnosticRequestFields(
  diagnostic: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(asString(diagnostic.method) ? { method: asString(diagnostic.method)! } : {}),
    ...(asString(diagnostic.path) ? { path: asString(diagnostic.path)! } : {}),
    ...(diagnostic.requestHeaders ? { headers: redactDiagnosticSupportValue(diagnostic.requestHeaders) } : {}),
    ...(diagnostic.requestBody !== undefined
      ? { body: redactDiagnosticSupportValue(diagnostic.requestBody) }
      : {}),
  };
}

function diagnosticResponseFields(
  diagnostic: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(asNumber(diagnostic.responseStatus) !== undefined
      ? { status: asNumber(diagnostic.responseStatus)! }
      : {}),
    ...(diagnostic.responseHeaders ? { headers: redactDiagnosticSupportValue(diagnostic.responseHeaders) } : {}),
    ...(diagnostic.responseBody !== undefined
      ? { body: redactDiagnosticSupportValue(diagnostic.responseBody) }
      : {}),
  };
}
