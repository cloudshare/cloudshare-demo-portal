import { randomUUID } from "node:crypto";
import type { Logger } from "@/observability/logger";
import type { EventLogRepository } from "@/domain/event-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import {
  suspendExam,
  resumeExam,
  type SuspendExamDeps,
  type ResumeExamDeps,
} from "@/domain/timer-sync";
import {
  InvalidExamAttemptStatusError,
  LabLaunchNotFoundError,
  TimerSyncError,
} from "@/domain/errors";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { ensureExamAttemptEnvironmentCorrelation } from "./exam-attempt-environment-correlation";

/**
 * Framework-agnostic handlers for the candidate-initiated suspend and resume
 * endpoints. They own the request validation, domain delegation, error mapping,
 * and logging — the Next.js routes are thin wrappers that supply the raw body
 * and return the plain `{ status, body }` response.
 */

export interface SuspendResumeRequest {
  readonly body: unknown;
}

export interface SuspendResumeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

interface SupportDiagnosticDeps {
  readonly logger: Logger;
  readonly eventLog: EventLogRepository;
  readonly newCorrelationId?: () => string;
  readonly now?: () => Date;
}

interface EnvironmentCorrelationDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
}

interface FailureHandlingSpec {
  readonly action: "suspend" | "resume";
  readonly operation: string;
  readonly eventType: string;
  readonly logMessage: string;
}

// --- Suspend ---

export interface SuspendHandlerDeps
  extends SuspendExamDeps,
    SupportDiagnosticDeps,
    EnvironmentCorrelationDeps {}

export async function handleSuspendExam(
  deps: SuspendHandlerDeps,
  request: SuspendResumeRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  try {
    await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId,
      operation: "exam_suspend",
    });
    await suspendExam(deps, { examAttemptId });
    deps.logger.info("exam suspended", { examAttemptId });
    return { status: 200, body: { status: "suspended", examAttemptId } };
  } catch (err) {
    return handleTimerSyncError(deps, err, "suspend", examAttemptId);
  }
}

// --- Resume ---

export interface ResumeHandlerDeps
  extends ResumeExamDeps,
    SupportDiagnosticDeps,
    EnvironmentCorrelationDeps {}

export interface HeartbeatAutoSuspendHandlerDeps
  extends SuspendExamDeps,
    SupportDiagnosticDeps,
    EnvironmentCorrelationDeps {}

export async function handleResumeExam(
  deps: ResumeHandlerDeps,
  request: SuspendResumeRequest,
): Promise<SuspendResumeResponse> {
  const examAttemptId = extractExamAttemptId(request.body);
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  try {
    await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId,
      operation: "exam_resume",
    });
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
    return handleTimerSyncError(deps, err, "resume", examAttemptId);
  }
}

export async function runHeartbeatAutoSuspend(
  deps: HeartbeatAutoSuspendHandlerDeps,
  examAttemptId: string,
): Promise<void> {
  try {
    await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId,
      operation: "heartbeat_auto_suspend",
    });
    await suspendExam(deps, { examAttemptId });
  } catch (err) {
    await reportFailureDiagnostic(
      deps,
      err,
      examAttemptId,
      {
        action: "suspend",
        operation: "heartbeat_auto_suspend",
        eventType: "cloudshare.heartbeat_auto_suspend.failed",
        logMessage: "heartbeat auto-suspend failed",
      },
    );
    throw err;
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

async function handleTimerSyncError(
  deps: SupportDiagnosticDeps,
  err: unknown,
  action: "suspend" | "resume",
  examAttemptId: string,
): Promise<SuspendResumeResponse> {
  if (err instanceof LabLaunchNotFoundError) {
    return { status: 404, body: { error: "no lab launch found for exam attempt" } };
  }
  if (err instanceof InvalidExamAttemptStatusError) {
    return {
      status: 409,
      body: {
        error: err.message,
        ...(err.context ?? {}),
      },
    };
  }
  const failure = await reportFailureDiagnostic(
    deps,
    err,
    examAttemptId,
    {
      action,
      operation: `exam_${action}`,
      eventType: `cloudshare.exam_${action}.failed`,
      logMessage: `exam ${action} failed`,
    },
  );
  if (failure) {
    return failure;
  }

  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const diagnostic = {
    correlationId,
    examAttemptId,
    operation: `exam_${action}`,
    attemptedOperation: `${action}_exam`,
    failureMode: "unexpected_internal_error",
    error: err instanceof Error ? err.message : String(err),
  };
  await deps.eventLog.append({
    eventId: correlationId,
    type: `cloudshare.exam_${action}.failed`,
    occurredAt: (deps.now ?? (() => new Date()))(),
    payload: diagnostic,
  });
  deps.logger.error(`exam ${action} errored`, diagnostic);
  return { status: 500, body: { error: "internal error", correlationId } };
}

async function reportFailureDiagnostic(
  deps: SupportDiagnosticDeps,
  err: unknown,
  examAttemptId: string,
  spec: FailureHandlingSpec,
): Promise<SuspendResumeResponse | null> {
  if (err instanceof TimerSyncError) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = buildTimerSyncDiagnostic(
      correlationId,
      spec.action,
      spec.operation,
      examAttemptId,
      err,
    );
    await deps.eventLog.append({
      eventId: correlationId,
      type: spec.eventType,
      occurredAt: (deps.now ?? (() => new Date()))(),
      payload: diagnostic,
    });
    deps.logger.warn(spec.logMessage, diagnostic);
    return { status: 502, body: { error: `exam ${spec.action} failed`, correlationId } };
  }

  if (isCloudShareFailure(err)) {
    const correlationId = (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = buildCloudShareDiagnostic(
      correlationId,
      spec.action,
      spec.operation,
      examAttemptId,
      err,
    );
    await deps.eventLog.append({
      eventId: correlationId,
      type: spec.eventType,
      occurredAt: (deps.now ?? (() => new Date()))(),
      payload: diagnostic,
    });
    deps.logger.warn(spec.logMessage, diagnostic);
    return { status: 502, body: { error: `exam ${spec.action} failed`, correlationId } };
  }

  return null;
}

function buildTimerSyncDiagnostic(
  correlationId: string,
  action: "suspend" | "resume",
  operation: string,
  examAttemptId: string,
  err: TimerSyncError,
): Record<string, unknown> {
  return {
    correlationId,
    examAttemptId,
    operation,
    attemptedOperation: "poll_environment_status",
    integrationSurface: "cloudshare.v3.environment",
    method: "GET",
    path:
      typeof err.context?.environmentExternalId === "string"
        ? `/api/v3/environments?externalId=${err.context.environmentExternalId}`
        : "/api/v3/environments?externalId={environmentExternalId}",
    failureMode: "confirmation_timeout",
    error: err.message,
    ...(err.context ?? {}),
  };
}

function buildCloudShareDiagnostic(
  correlationId: string,
  action: "suspend" | "resume",
  operation: string,
  examAttemptId: string,
  err: CloudShareRequestError | CloudShareTransportError | CloudShareResponseError,
): Record<string, unknown> {
  const staticSpec =
    action === "suspend"
      ? {
          attemptedOperation: "suspend_environment",
          integrationSurface: "cloudshare.v4.environment.action.suspend",
          method: "POST",
          path:
            typeof err.context?.environmentExternalId === "string"
              ? `/v4/environments/${err.context.environmentExternalId}/actions/suspend`
              : "/v4/environments/{environmentExternalId}/actions/suspend",
        }
      : {
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v4.environment.action.resume",
          method: "POST",
          path:
            typeof err.context?.environmentExternalId === "string"
              ? `/v4/environments/${err.context.environmentExternalId}/actions/resume`
              : "/v4/environments/{environmentExternalId}/actions/resume",
        };

  const base = {
    correlationId,
    examAttemptId,
    operation,
    attemptedOperation: staticSpec.attemptedOperation,
    integrationSurface: err.context?.integrationSurface ?? staticSpec.integrationSurface,
    method: err.context?.method ?? staticSpec.method,
    path: err.context?.path ?? staticSpec.path,
    host: err.context?.host,
  };

  if (err instanceof CloudShareRequestError) {
    return {
      ...base,
      failureMode: "http_status",
      responseStatus: err.status,
      requestHeaders: err.context?.requestHeaders,
      requestBody: err.context?.requestBody,
      responseHeaders: err.context?.responseHeaders,
      responseBody: err.context?.responseBody,
      network: err.context?.network,
      tls: err.context?.tls,
    };
  }

  if (err instanceof CloudShareTransportError) {
    return {
      ...base,
      failureMode: "transport",
      requestHeaders: err.context?.requestHeaders,
      requestBody: err.context?.requestBody,
      cause: err.context?.cause,
    };
  }

  return {
    ...base,
    failureMode: "unexpected_response",
    requestHeaders: err.context?.requestHeaders,
    requestBody: err.context?.requestBody,
    responseHeaders: err.context?.responseHeaders,
    responseBody: err.context?.responseBody,
    network: err.context?.network,
    tls: err.context?.tls,
    issues: err.context?.issues,
  };
}

function isCloudShareFailure(
  err: unknown,
): err is CloudShareRequestError | CloudShareTransportError | CloudShareResponseError {
  return (
    err instanceof CloudShareRequestError ||
    err instanceof CloudShareTransportError ||
    err instanceof CloudShareResponseError
  );
}
