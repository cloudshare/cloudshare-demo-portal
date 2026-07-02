import { randomUUID } from "node:crypto";
import type { ExamAttempt } from "@/domain/exam-attempt";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { SuspendHandlerDeps, SuspendResumeResponse } from "./exam-attempt-suspend-resume-runtime";
import { suspendExamAttemptRuntime } from "./exam-attempt-suspend-resume-runtime";

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

  if (attempt.status === "in_progress") {
    const cleanup = await suspendExamAttemptRuntime(deps, request);
    if (cleanup.status !== 200) {
      await recordCandidateEarlyCompletionFailureDiagnostic(
        deps.diagnostics,
        attempt,
        cleanup,
        deps.candidateEmail,
      );
      return mapCleanupResponseToCompleteResponse(cleanup, request.examAttemptId);
    }

    const suspendedAttempt = await deps.attempts.findById(request.examAttemptId);
    if (!suspendedAttempt) {
      return { status: 404, body: { error: "exam attempt not found" } };
    }

    const completion = await tryMarkAttemptCompleted(deps, suspendedAttempt, "in_progress");
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

  if (attempt.status === "suspended") {
    const completion = await tryMarkAttemptCompleted(deps, attempt, "suspended");
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
      message: "Your lab has been stopped, but completion is still being saved. Retry End exam.",
    },
  };
}

function mapCleanupResponseToCompleteResponse(
  cleanup: SuspendResumeResponse,
  examAttemptId: string,
): SuspendResumeResponse {
  const correlationId =
    typeof cleanup.body.correlationId === "string" ? cleanup.body.correlationId : undefined;

  if (cleanup.status === 202) {
    return {
      status: 202,
      body: {
        status: "pending",
        operation: "complete",
        examAttemptId,
        retryable: true,
        ...(correlationId ? { correlationId } : {}),
        message: "CloudShare is still stopping your lab. Wait a few seconds, then retry End exam.",
      },
    };
  }

  if (cleanup.status === 409) {
    return {
      status: 409,
      body: {
        error: "Exam completion is not available for this attempt.",
        examAttemptId,
        operation: "complete",
        ...(typeof cleanup.body.currentStatus === "string"
          ? { currentStatus: cleanup.body.currentStatus }
          : {}),
      },
    };
  }

  return {
    status: cleanup.status,
    body: {
      error: "Unable to end exam until CloudShare cleanup is confirmed.",
      examAttemptId,
      operation: "complete",
      retryable: cleanup.status >= 500,
      ...(correlationId ? { correlationId } : {}),
    },
  };
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
        typeof cleanup.body.operation === "string" ? cleanup.body.operation : "suspend",
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
