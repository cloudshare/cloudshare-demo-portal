import { randomUUID } from "node:crypto";
import type { ExamAttempt } from "@/domain/exam-attempt";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EnvironmentCommandResult } from "@/domain/environment";
import { ExamAttemptRuntimeError } from "@/domain/errors";
import { archiveExam, type ArchiveExamResult } from "@/domain/exam-attempt-runtime-lifecycle";
import { CLOUDSHARE_429_SUPPORT_GUIDANCE } from "@/domain/cloudshare-rate-limit-message";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import { createCloudShareEnvironmentController } from "@/integrations/cloudshare/environment-controller";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import { ensureExamAttemptEnvironmentCorrelation } from "./exam-attempt-environment-correlation";
import type { SuspendHandlerDeps, SuspendResumeResponse } from "./exam-attempt-suspend-resume-runtime";

export interface CompleteExamAttemptEarlyHandlerDeps extends SuspendHandlerDeps {}

export interface CompleteExamAttemptEarlyRequest {
  readonly examAttemptId: string;
}

export async function completeExamAttemptEarlyRuntime(
  deps: CompleteExamAttemptEarlyHandlerDeps,
  request: CompleteExamAttemptEarlyRequest,
): Promise<SuspendResumeResponse> {
  const attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }

  if (attempt.status === "in_progress" || attempt.status === "suspended") {
    const cleanup = await tryArchiveExamEnvironmentForCompletion(deps, attempt, request);
    if (!cleanup.ok) {
      await recordCandidateEarlyCompletionFailureDiagnostic(
        deps.diagnostics,
        attempt,
        cleanup.response,
        deps.candidateEmail,
      );
      return cleanup.response;
    }

    const currentAttempt = await deps.attempts.findById(request.examAttemptId);
    if (!currentAttempt) {
      return { status: 404, body: { error: "exam attempt not found" } };
    }

    const completion = await tryMarkAttemptCompleted(deps, currentAttempt, attempt.status);
    if (!completion.ok) {
      return buildPersistencePendingResponse(
        request.examAttemptId,
        completion.correlationId,
      );
    }
    return {
      status: 200,
      body: { status: "completed", examAttemptId: request.examAttemptId },
    };
  }

  await recordCandidateEarlyCompletionInvalidStatusDiagnostic(
    deps.diagnostics,
    attempt,
    deps.candidateEmail,
  );
  return {
    status: 409,
    body: {
      error: "Exam completion is not available for this attempt.",
      examAttemptId: request.examAttemptId,
      operation: "complete",
      currentStatus: attempt.status,
    },
  };
}

async function tryArchiveExamEnvironmentForCompletion(
  deps: CompleteExamAttemptEarlyHandlerDeps,
  attempt: ExamAttempt,
  request: CompleteExamAttemptEarlyRequest,
): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly response: SuspendResumeResponse }
> {
  try {
    const access = await resolveCustomerEnvironmentAccess(deps, attempt);
    const correlation = await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId: request.examAttemptId,
      operation: "exam_complete",
    });
    const verifiedEnvironmentExternalId = await requireVerifiedEnvironmentExternalId(
      deps,
      request.examAttemptId,
      correlation.actionableEnvironmentId,
    );
    const archive = await archiveExam(
      {
        ...deps,
        ...access,
      },
      {
        examAttemptId: request.examAttemptId,
        verifiedEnvironmentExternalId,
      },
    );
    await recordArchiveSuccessDiagnostic(
      deps.diagnostics,
      attempt,
      archive,
      deps.candidateEmail,
    );
    return { ok: true };
  } catch (error) {
    const correlationId = deps.newCorrelationId?.() ?? randomUUID();
    await recordArchiveFailureDiagnostic(
      deps.diagnostics,
      attempt,
      error,
      correlationId,
      deps.candidateEmail,
    );
    return {
      ok: false,
      response: mapArchiveErrorToCompleteResponse(error, request.examAttemptId, correlationId),
    };
  }
}

async function resolveCustomerEnvironmentAccess(
  deps: CompleteExamAttemptEarlyHandlerDeps,
  attempt: ExamAttempt,
) {
  if (!attempt.customerId) {
    throw new ExamAttemptRuntimeError(
      "Exam attempt is missing a Customer CloudShare connection binding.",
      { examAttemptId: attempt.id },
    );
  }

  const connection = await deps.connections.findByCustomerId(attempt.customerId);
  if (!connection) {
    throw new ExamAttemptRuntimeError(
      "No stored CloudShare connection exists for the exam attempt customer.",
      { examAttemptId: attempt.id, customerId: attempt.customerId },
    );
  }

  const client = deps.cloudshare.forConnection(connection);
  return {
    controller: createCloudShareEnvironmentController(client),
    source: createCloudShareEnvironmentSource(client),
  };
}

async function requireVerifiedEnvironmentExternalId(
  deps: Pick<CompleteExamAttemptEarlyHandlerDeps, "launches">,
  examAttemptId: string,
  actionableEnvironmentId: string | null,
): Promise<string | undefined> {
  if (actionableEnvironmentId) {
    return actionableEnvironmentId;
  }

  const launch = await deps.launches.findByExamAttemptId(examAttemptId);
  if (!launch) {
    return undefined;
  }
  throw new ExamAttemptRuntimeError("No CloudShare environment is correlated to this exam attempt yet.", {
    examAttemptId,
    labLaunchId: launch.id,
    trainingId: launch.trainingId,
    attemptedOperation: "resolve_environment_correlation",
    integrationSurface: "cloudshare.v4.training.participant_list",
    method: "GET",
    path: launch.trainingId
      ? `/v4/trainings/${launch.trainingId}/students`
      : "/v4/trainings/{trainingId}/students",
    failureMode: "not_correlated_yet",
    currentEnvironmentExternalId:
      launch.environmentExternalId ?? launch.environmentId ?? null,
  });
}

async function tryMarkAttemptCompleted(
  deps: Pick<
    CompleteExamAttemptEarlyHandlerDeps,
    "attempts" | "diagnostics" | "candidateEmail" | "newCorrelationId"
  >,
  attempt: ExamAttempt,
  priorStatus: ExamAttempt["status"],
): Promise<{ readonly ok: true } | { readonly ok: false; readonly correlationId: string }> {
  try {
    await markAttemptCompleted(deps, attempt, priorStatus);
    return { ok: true };
  } catch (error) {
    const correlationId = deps.newCorrelationId?.() ?? randomUUID();
    const currentAttempt = await deps.attempts.findById(attempt.id).catch(() => null);
    await recordCandidateEarlyCompletionPersistenceFailureDiagnostic(
      deps.diagnostics,
      currentAttempt ?? attempt,
      priorStatus,
      currentAttempt?.status ?? attempt.status,
      error,
      correlationId,
      deps.candidateEmail,
    );
    return { ok: false, correlationId };
  }
}

function buildPersistencePendingResponse(
  examAttemptId: string,
  correlationId: string,
): SuspendResumeResponse {
  return {
    status: 202,
    body: {
      status: "pending",
      operation: "complete",
      examAttemptId,
      retryable: true,
      correlationId,
      environmentArchived: true,
      message: "Your lab has been archived, but completion is still being saved. Retry End exam.",
    },
  };
}

function mapArchiveErrorToCompleteResponse(
  error: unknown,
  examAttemptId: string,
  correlationId: string,
): SuspendResumeResponse {
  if (isRetryableArchiveRuntimeError(error)) {
    return {
      status: 202,
      body: {
        status: "pending",
        operation: "complete",
        examAttemptId,
        retryable: true,
        correlationId,
        message: "CloudShare is still archiving your lab. Wait a few seconds, then retry End exam.",
      },
    };
  }

  const retryable =
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    (error instanceof CloudShareRequestError && error.status >= 500);

  if (isCloudShareRateLimitError(error)) {
    return {
      status: 429,
      body: {
        error: CLOUDSHARE_429_SUPPORT_GUIDANCE,
        examAttemptId,
        operation: "complete",
        retryable: true,
        correlationId,
      },
    };
  }

  if (error instanceof CloudShareRequestError && error.status < 500) {
    return {
      status: 502,
      body: {
        error: "Unable to archive your CloudShare lab before ending the exam.",
        examAttemptId,
        operation: "complete",
        retryable: false,
        correlationId,
      },
    };
  }

  return {
    status: 502,
    body: {
      error: "Unable to archive your CloudShare lab before ending the exam.",
      examAttemptId,
      operation: "complete",
      retryable,
      correlationId,
    },
  };
}

function isRetryableArchiveRuntimeError(error: unknown): error is ExamAttemptRuntimeError {
  if (!(error instanceof ExamAttemptRuntimeError)) {
    return false;
  }
  return error.context?.failureMode === "not_correlated_yet" || error.context?.target === "archived";
}

async function markAttemptCompleted(
  deps: Pick<CompleteExamAttemptEarlyHandlerDeps, "attempts" | "diagnostics" | "candidateEmail">,
  attempt: ExamAttempt,
  priorStatus: ExamAttempt["status"],
): Promise<void> {
  const completedAttempt = {
    ...attempt,
    status: "completed" as const,
  };
  await deps.attempts.save(completedAttempt);
  await recordCandidateEarlyCompletionDiagnostic(
    deps.diagnostics,
    completedAttempt,
    priorStatus,
    deps.candidateEmail,
  );
}

async function recordCandidateEarlyCompletionDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  priorStatus: ExamAttempt["status"],
  candidateEmail?: string | null,
): Promise<void> {
  await diagnostics?.record({
    source: "runtime",
    level: "info",
    operation: "exam_attempt.complete",
    outcome: "success",
    message: "Exam completed early by candidate",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    details: {
      completedBy: "candidate_early_completion",
      priorStatus,
      attemptStatus: "completed",
    },
  });
}

async function recordArchiveSuccessDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  archive: ArchiveExamResult,
  candidateEmail?: string | null,
): Promise<void> {
  const commandDiagnostic = archive.commandResult
    ? commandResultToDiagnostic(archive.commandResult)
    : {
        externalIds: { environmentId: archive.environmentExternalId },
        request: null,
        response: null,
        details: {
          attemptedOperation: "archive_environment",
          integrationSurface: "cloudshare.v3.env.action.archive",
          alreadyArchived: true,
          completedBy: "candidate_early_completion",
        },
      };

  await diagnostics?.record({
    source: "runtime",
    level: "info",
    operation: "cloudshare.environment.archive",
    outcome: "success",
    message: archive.alreadyArchived
      ? "CloudShare environment was already archived before early completion"
      : "CloudShare environment archived for early completion",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    ...commandDiagnostic,
  });
}

async function recordArchiveFailureDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  error: unknown,
  correlationId: string,
  candidateEmail?: string | null,
): Promise<void> {
  await diagnostics?.record({
    source: "runtime",
    level: "warn",
    operation: "cloudshare.environment.archive",
    outcome: "failure",
    message: "CloudShare environment archive failed for early completion",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    correlationId,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    details: {
      attemptedOperation: "archive_environment",
      integrationSurface: "cloudshare.v3.env.action.archive",
      method: "PUT",
      path: "/api/v3/envs/actions/archive",
      completedBy: "candidate_early_completion",
      ...cloudShareFailureDetails(error),
    },
  });
}

function commandResultToDiagnostic(
  commandResult: EnvironmentCommandResult,
): {
  readonly externalIds: { readonly environmentId: string };
  readonly request?: Record<string, unknown> | null;
  readonly response?: Record<string, unknown> | null;
  readonly details: Record<string, unknown>;
} {
  return {
    externalIds: commandResult.externalIds,
    request: commandResult.request ?? null,
    response: commandResult.response ?? null,
    details: {
      attemptedOperation: commandResult.attemptedOperation,
      integrationSurface: commandResult.integrationSurface,
      method: commandResult.method,
      path: commandResult.path,
      completedBy: "candidate_early_completion",
      ...(commandResult.host ? { host: commandResult.host } : {}),
    },
  };
}

function cloudShareFailureDetails(error: unknown): Record<string, unknown> {
  if (isCloudShareRateLimitError(error)) {
    return {
      failureMode: "rate_limit",
      responseStatus: error.status,
      ...(error.context ?? {}),
    };
  }
  if (error instanceof CloudShareRequestError) {
    return {
      failureMode: "http_status",
      responseStatus: error.status,
      ...(error.context ?? {}),
    };
  }
  if (error instanceof CloudShareTransportError) {
    return {
      failureMode: "transport",
      ...(error.context ?? {}),
    };
  }
  if (error instanceof CloudShareResponseError) {
    return {
      failureMode: "unexpected_response",
      ...(error.context ?? {}),
    };
  }
  if (error instanceof ExamAttemptRuntimeError) {
    return {
      failureMode: error.context?.failureMode ?? "runtime_state",
      ...(error.context ?? {}),
      error: error.message,
    };
  }
  return {
    failureMode: "unknown",
    error: error instanceof Error ? error.message : String(error),
  };
}

async function recordCandidateEarlyCompletionFailureDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  cleanup: SuspendResumeResponse,
  candidateEmail?: string | null,
): Promise<void> {
  const correlationId =
    typeof cleanup.body.correlationId === "string" ? cleanup.body.correlationId : null;
  await diagnostics?.record({
    source: "runtime",
    level: "warn",
    operation: "exam_attempt.complete",
    outcome: "failure",
    message: "Exam early completion blocked until CloudShare cleanup is confirmed",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    correlationId,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    details: {
      completedBy: "candidate_early_completion",
      failureMode: "cleanup_not_confirmed",
      cleanupStatus: cleanup.status,
      cleanupOperation:
        typeof cleanup.body.operation === "string" ? cleanup.body.operation : "archive",
      currentStatus: attempt.status,
      ...(correlationId ? { correlationId } : {}),
    },
  });
}

async function recordCandidateEarlyCompletionPersistenceFailureDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  priorStatus: ExamAttempt["status"],
  currentStatus: ExamAttempt["status"],
  error: unknown,
  correlationId: string,
  candidateEmail?: string | null,
): Promise<void> {
  await diagnostics?.record({
    source: "runtime",
    level: "warn",
    operation: "exam_attempt.complete",
    outcome: "failure",
    message: "Exam early completion persistence failed after CloudShare cleanup",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    correlationId,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    details: {
      completedBy: "candidate_early_completion",
      failureMode: "completion_persistence_failed",
      priorStatus,
      currentStatus,
      error: error instanceof Error ? error.message : String(error),
    },
  });
}

async function recordCandidateEarlyCompletionInvalidStatusDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  candidateEmail?: string | null,
): Promise<void> {
  await diagnostics?.record({
    source: "runtime",
    level: "warn",
    operation: "exam_attempt.complete",
    outcome: "failure",
    message: "Exam early completion rejected for current attempt status",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    details: {
      completedBy: "candidate_early_completion",
      failureMode: "invalid_status",
      currentStatus: attempt.status,
    },
  });
}
