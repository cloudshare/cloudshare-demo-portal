import type { Logger } from "@/observability/logger";
import {
  suspendExam,
  resumeExam,
  type SuspendExamDeps,
  type ResumeExamDeps,
} from "@/domain/timer-sync";
import { LabLaunchNotFoundError, TimerSyncError } from "@/domain/errors";

/**
 * Framework-agnostic handlers for the candidate-initiated suspend and resume
 * endpoints. They own the request validation, domain delegation, error mapping,
 * and logging — the Next.js routes are thin wrappers that supply the raw body
 * and return the plain `{ status, body }` response.
 *
 * HTTP contract for both endpoints:
 *  - 400  missing/invalid examAttemptId
 *  - 404  no lab launch found for the exam attempt
 *  - 200  success — environment transition confirmed and timer synced
 *  - 502  CloudShare or poll timeout error
 *  - 500  unexpected internal error
 */

export interface SuspendResumeRequest {
  readonly body: unknown;
}

export interface SuspendResumeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// --- Suspend ---

export interface SuspendHandlerDeps extends SuspendExamDeps {
  readonly logger: Logger;
}

export async function handleSuspendExam(
  deps: SuspendHandlerDeps,
  request: SuspendResumeRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  try {
    await suspendExam(deps, { examAttemptId });
    deps.logger.info("exam suspended", { examAttemptId });
    return { status: 200, body: { status: "suspended", examAttemptId } };
  } catch (err) {
    return handleTimerSyncError(err, deps.logger, "suspend", examAttemptId);
  }
}

// --- Resume ---

export interface ResumeHandlerDeps extends ResumeExamDeps {
  readonly logger: Logger;
}

export async function handleResumeExam(
  deps: ResumeHandlerDeps,
  request: SuspendResumeRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  try {
    const result = await resumeExam(deps, { examAttemptId });
    deps.logger.info("exam resumed", {
      examAttemptId,
      environmentExternalId: result.environmentExternalId,
    });
    return {
      status: 200,
      body: {
        status: "resumed",
        examAttemptId,
        environmentExternalId: result.environmentExternalId,
        suspendedPreservationLimitMs: result.suspendedPreservationLimitMs,
      },
    };
  } catch (err) {
    return handleTimerSyncError(err, deps.logger, "resume", examAttemptId);
  }
}

// --- Helpers ---

function extractExamAttemptId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { examAttemptId } = body as { examAttemptId?: unknown };
  return typeof examAttemptId === "string" && examAttemptId.trim().length > 0
    ? examAttemptId.trim()
    : null;
}

function handleTimerSyncError(
  err: unknown,
  logger: Logger,
  action: string,
  examAttemptId: string,
): SuspendResumeResponse {
  if (err instanceof LabLaunchNotFoundError) {
    return { status: 404, body: { error: "no lab launch found for exam attempt" } };
  }
  if (err instanceof TimerSyncError) {
    logger.error(`exam ${action} failed`, {
      examAttemptId,
      error: err.message,
      ...(err.context ?? {}),
    });
    return { status: 502, body: { error: `exam ${action} failed` } };
  }
  logger.error(`exam ${action} errored`, {
    examAttemptId,
    error: err instanceof Error ? err.message : String(err),
  });
  return { status: 500, body: { error: "internal error" } };
}
