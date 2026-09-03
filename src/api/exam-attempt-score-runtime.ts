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
import type { CloudShareClientObservationOptions, CloudShareConnectionRecord, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import { CLOUDSHARE_429_CANDIDATE_MESSAGE } from "@/domain/cloudshare-rate-limit-message";
import type { ParticipantLister } from "@/domain/environment-correlation";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import { LabLaunchNotFoundError, ScoreRetrievalError } from "@/domain/errors";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import { projectCloudShareGenericLogValue, redactCloudShareAdminSupportValue } from "@/integrations/cloudshare/diagnostic-redaction";
import { projectCloudShareFailureContext } from "@/integrations/cloudshare/diagnostic-failure-projection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";

export interface ExamAttemptScoreRuntimeDeps {
  readonly exams: ExamRepository;
  readonly launches: LabLaunchRepository;
  readonly audit: AuditRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly createScoreRetriever: (
    connection: CloudShareConnectionRecord,
    observation: CloudShareClientObservationOptions,
  ) => ScoreRetrievalProvider;
  readonly createParticipantLister: (
    connection: CloudShareConnectionRecord,
    observation: CloudShareClientObservationOptions,
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

  const exam = await deps.exams.findById(attempt.examId);
  if (!exam || exam.customerId !== request.customerId) {
    return { status: 404, body: { error: "exam not found for attempt" } };
  }

  if (!isScoreEligibleAttempt(attempt, exam.openPeriodMinutes, (deps.now ?? (() => new Date()))())) {
    return {
      status: 409,
      body: { error: "score is only available after the exam attempt is completed or the Exam open period has closed" },
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
      customerId: request.customerId,
      actorType: "candidate",
      actorId: attempt.candidateId,
      subjectType: "exam_attempt",
      subjectId: examAttemptId,
      examAttemptId,
      candidateId: attempt.candidateId,
      examId: attempt.examId,
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
      request.customerId,
      attempt.examId,
      examAttemptId,
      attempt.candidateId,
      launch.experienceId,
      correlationId,
      diagnostic,
      "Score retrieval failed.",
    );
    logScoreRetrievalFailure(deps.logger, diagnostic);
    return {
      status: 502,
      body: {
        error: "score retrieval failed",
        correlationId,
      },
    };
  }

  const scoreCorrelationId = (deps.newCorrelationId ?? randomUUID)();
  const observation = scoreObservation(attempt, request.customerId, scoreCorrelationId);
  try {
    const resolvedParticipantId = await resolveLaunchParticipantId(
      deps,
      connection,
      request.customerId,
      attempt.examId,
      attempt.candidateId,
      examAttemptId,
      launch,
      observation,
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

    const scoreRetriever = deps.createScoreRetriever(connection, observation);
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
        customerId: request.customerId,
        actorType: "candidate",
        actorId: attempt.candidateId,
        subjectType: "exam_attempt",
        subjectId: examAttemptId,
        examAttemptId,
        candidateId: attempt.candidateId,
        examId: attempt.examId,
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
        response: {
          scoreAvailable: false,
          reason: result.reason,
          experienceId: result.experienceId,
          retrievedAt: result.retrievedAt,
        },
        ...(scoreRetrieval
          ? {
              request: { ...scoreRetrieval.request },
              details: {
                cloudShareResponse: scoreRetrieval.response ? { ...scoreRetrieval.response } : null,
              },
            }
          : {}),
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
      customerId: request.customerId,
      actorType: "candidate",
      actorId: attempt.candidateId,
      subjectType: "exam_attempt",
      subjectId: examAttemptId,
      examAttemptId,
      candidateId: attempt.candidateId,
      examId: attempt.examId,
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
        exploredRate: result.exploredRate,
        inProgressRate: result.inProgressRate,
        notStartedRate: result.notStartedRate,
        passedRate: result.passedRate,
        failedRate: result.failedRate,
        notInitiatedRate: result.notInitiatedRate,
        retrievedAt: result.retrievedAt,
      },
      ...(scoreRetrieval
        ? {
            request: { ...scoreRetrieval.request },
            details: {
              cloudShareResponse: scoreRetrieval.response ? { ...scoreRetrieval.response } : null,
            },
          }
        : {}),
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
        customerId: request.customerId,
        actorType: "candidate",
        actorId: attempt.candidateId,
        subjectType: "exam_attempt",
        subjectId: examAttemptId,
        examAttemptId,
        candidateId: attempt.candidateId,
        examId: attempt.examId,
        correlationId,
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
      logScoreRetrievalFailure(deps.logger, diagnostic);
      const rateLimited = asString(diagnostic.failureMode) === "rate_limit";
      return {
        status: rateLimited ? 429 : 502,
        body: {
          error: rateLimited
            ? CLOUDSHARE_429_CANDIDATE_MESSAGE
            : "score retrieval failed",
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

function isScoreEligibleAttempt(
  attempt: ExamAttempt,
  openPeriodMinutes: number,
  now: Date,
): boolean {
  if (attempt.status === "completed") {
    return true;
  }
  if ((attempt.status !== "in_progress" && attempt.status !== "suspended") || !attempt.scheduledFor) {
    return false;
  }

  return now.getTime() >= attempt.scheduledFor.getTime() + openPeriodMinutes * 60_000;
}

async function resolveLaunchParticipantId(
  deps: ExamAttemptScoreRuntimeDeps,
  connection: CloudShareConnectionRecord,
  customerId: string,
  examId: string,
  candidateId: string,
  examAttemptId: string,
  launch: NonNullable<Awaited<ReturnType<LabLaunchRepository["findByExamAttemptId"]>>>,
  observation: CloudShareClientObservationOptions,
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
      customerId,
      examId,
      examAttemptId,
      candidateId,
      launch.experienceId,
      correlationId,
      diagnostic,
      "Score retrieval failed.",
    );
    logScoreRetrievalFailure(deps.logger, diagnostic);
    return {
      ok: false,
      response: {
        status: 502,
        body: { error: "score retrieval failed", correlationId },
      },
    };
  }

  try {
    const participants = deps.createParticipantLister(connection, observation);
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
      customerId,
      examId,
      examAttemptId,
      candidateId,
      launch.experienceId,
      correlationId,
      diagnostic,
      "Score retrieval failed.",
    );
    logScoreRetrievalFailure(deps.logger, diagnostic);
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

  const missingCorrelationId = (deps.newCorrelationId ?? randomUUID)();
  const diagnostic = buildParticipantResolutionDiagnostic(
    missingCorrelationId,
    customerId,
    examAttemptId,
    launch,
    "missing_participant_id",
  );
  await deps.diagnostics?.record({
    ...scoreDiagnosticAnchors(examAttemptId, customerId, candidateId, launch, missingCorrelationId),
    level: "warn",
    operation: "exam_attempt.score.correlate_environment",
    outcome: "failure",
    message: "Score retrieval failed: could not correlate CloudShare environment participant",
    externalIds: scoreCorrelationExternalIds(launch),
    details: toSupportDetailFields(diagnostic),
  });
  await writeScoreFailureAudit(
    deps,
    customerId,
    examId,
    examAttemptId,
    candidateId,
    launch.experienceId,
    missingCorrelationId,
    diagnostic,
    "Score retrieval failed.",
  );
  logScoreRetrievalFailure(deps.logger, diagnostic);
  return {
    ok: false,
    response: {
      status: 502,
      body: { error: "score retrieval failed", correlationId: missingCorrelationId },
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
    isOAuthFailureContext(cause) ||
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
    isOAuthFailureContext(error) ||
    isCloudShareRateLimitError(error) ||
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
  cause: unknown,
): Record<string, unknown> {
  const cloudShareCause = cause as CloudShareRequestError | CloudShareTransportError | CloudShareResponseError;
  const projected = projectCloudShareFailureContext(cloudShareCause.context);
  if (projected?.request === null && projected.response === null) {
    const responseStatus = typeof (cause as { status?: unknown }).status === "number"
      ? (cause as { status: number }).status
      : typeof cloudShareCause.context?.responseStatus === "number"
        ? cloudShareCause.context.responseStatus
        : typeof cloudShareCause.context?.status === "number"
          ? cloudShareCause.context.status
          : undefined;
    return {
      ...base,
      method: cloudShareCause.context?.method ?? base.method,
      path: cloudShareCause.context?.path ?? base.path,
      integrationSurface: cloudShareCause.context?.integrationSurface ?? base.integrationSurface,
      failureMode: isCloudShareRateLimitError(cause) ? "rate_limit" : cause instanceof CloudShareTransportError ? "transport" : cause instanceof CloudShareResponseError ? "unexpected_response" : "http_status",
      ...(responseStatus !== undefined ? { responseStatus } : {}),
    };
  }
  const shared = {
    ...base,
    method: cloudShareCause.context?.method ?? base.method,
    path: cloudShareCause.context?.path ?? base.path,
    host: cloudShareCause.context?.host,
    integrationSurface: cloudShareCause.context?.integrationSurface ?? base.integrationSurface,
    requestHeaders: redactDiagnosticSupportValue(cloudShareCause.context?.requestHeaders),
    requestBody: redactDiagnosticSupportValue(cloudShareCause.context?.requestBody),
  };

  if (isCloudShareRateLimitError(cause)) {
    return {
      ...shared,
      failureMode: "rate_limit",
      responseStatus: cause.status,
      responseHeaders: redactDiagnosticSupportValue(cause.context?.responseHeaders),
      responseBody: redactDiagnosticSupportValue(cause.context?.responseBody),
      network: cause.context?.network,
      tls: cause.context?.tls,
    };
  }

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
    responseHeaders: redactDiagnosticSupportValue(cloudShareCause.context?.responseHeaders),
    responseBody: redactDiagnosticSupportValue(cloudShareCause.context?.responseBody),
    network: cloudShareCause.context?.network,
    tls: cloudShareCause.context?.tls,
    issues: cloudShareCause.context?.issues,
  };
}

function scoreObservation(attempt: Pick<ExamAttempt, "id" | "examId" | "candidateId">, customerId: string, correlationId: string): CloudShareClientObservationOptions {
  return certificationCloudShareWorkflow({ actor: { type: "candidate", id: attempt.candidateId }, customerId, subject: { type: "exam_attempt", id: attempt.id }, correlationId, source: "runtime", examId: attempt.examId ?? undefined, examAttemptId: attempt.id });
}

function isOAuthFailureContext(error: unknown): boolean {
  const context = (error as { context?: Record<string, unknown> } | null)?.context;
  const projected = projectCloudShareFailureContext(context);
  return projected?.request === null && projected.response === null;
}

async function writeScoreFailureAudit(
  deps: Pick<ExamAttemptScoreRuntimeDeps, "audit" | "now">,
  customerId: string,
  examId: string,
  examAttemptId: string,
  candidateId: string,
  experienceId: string,
  correlationId: string,
  diagnostic: Record<string, unknown>,
  error: string,
): Promise<void> {
  await deps.audit.write({
    id: `${examAttemptId}:score_retrieved_failed:${correlationId}`,
    customerId,
    actorType: "candidate",
    actorId: candidateId,
    subjectType: "exam_attempt",
    subjectId: examAttemptId,
    examAttemptId,
    candidateId,
    examId,
    correlationId,
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

function logScoreRetrievalFailure(logger: Logger, diagnostic: Record<string, unknown>): void {
  logger.warn(
    "candidate score retrieval failed",
    projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>,
  );
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
): Record<string, unknown> | null {
  const projected = projectCloudShareFailureContext({ path: diagnostic.path, integrationSurface: diagnostic.integrationSurface });
  if (projected?.request === null) return null;
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
): Record<string, unknown> | null {
  const projected = projectCloudShareFailureContext({ path: diagnostic.path, integrationSurface: diagnostic.integrationSurface });
  if (projected?.response === null) return null;
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
