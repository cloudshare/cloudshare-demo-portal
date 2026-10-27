import { randomUUID } from "node:crypto";
import type { Logger } from "@/observability/logger";
import { projectEventLogMetadata, type EventLogRepository } from "@/domain/event-log";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { CLOUDSHARE_429_CANDIDATE_MESSAGE } from "@/domain/cloudshare-rate-limit-message";
import {
  suspendExam,
  resumeExam,
  SUSPENDED_PRESERVATION_LIMIT_MS,
  type SuspendExamDeps,
  type ResumeExamDeps,
} from "@/domain/exam-attempt-runtime-lifecycle";
import {
  ExamAttemptRuntimeError,
  InvalidExamAttemptStatusError,
  LabLaunchNotFoundError,
} from "@/domain/errors";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import { createCloudShareEnvironmentController } from "@/integrations/cloudshare/environment-controller";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";
import { projectCloudShareGenericLogValue } from "@/integrations/cloudshare/diagnostic-redaction";
import { ensureExamAttemptEnvironmentCorrelation } from "./exam-attempt-environment-correlation";
import {
  createCloudShareWorkflowSequenceAllocator,
  type CloudShareWorkflowSequenceAllocator,
} from "@/ports/cloudshare-observation";
import type { ExamClock } from "@/domain/exam-clock";
import type { ExamRepository } from "@/domain/exam-catalog";
import { settleExamAttemptCompletion } from "./exam-attempt-completion-settlement";
import type { EnvironmentCommandResult } from "@/domain/environment";
import {
  inspectExamAttemptExternalLease,
  reconcileExpiredExamAttemptExternalLease,
  recordExamAttemptExternalLeaseInspectionFailure,
} from "./exam-attempt-external-lease";

/**
 * Framework-agnostic runtime operations for candidate-initiated suspend,
 * resume, and heartbeat auto-suspend. HTTP adapters own request-body parsing
 * and response adaptation; this module owns lifecycle transitions, CloudShare
 * command orchestration, and support diagnostics.
 */

export interface SuspendResumeRuntimeRequest {
  readonly examAttemptId: string;
}

export interface SuspendResumeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

type ResumeDisposition = "resumed" | "already_active";

interface SupportDiagnosticDeps {
  readonly logger: Logger;
  readonly eventLog: EventLogRepository;
  readonly newCorrelationId?: () => string;
  readonly now?: () => Date;
  readonly diagnostics?: DiagnosticRecorder;
  readonly candidateEmail?: string;
}

interface EnvironmentCorrelationDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
}

interface CompletionReconciliationDeps {
  readonly exams?: ExamRepository;
  readonly clocks?: ExamClock;
}

interface FailureHandlingSpec {
  readonly action: "suspend" | "resume";
  readonly operation: string;
  readonly eventType: string;
  readonly logMessage: string;
}

interface PendingTransitionResponseSpec {
  readonly body: {
    readonly status: "pending";
    readonly operation: "suspend" | "resume";
    readonly examAttemptId: string;
    readonly retryable: true;
    readonly message: string;
    readonly correlationId: string;
  };
  readonly status: 202;
}

interface RuntimeDiagnosticAnchors {
  readonly source: "runtime";
  readonly customerId: string | null;
  readonly candidateEmail: string | null;
  readonly examId: string | null;
  readonly examAttemptId: string;
  readonly correlationId?: string | null;
  readonly actor: { readonly type: "candidate"; readonly id: string | null; readonly email: string | null };
  readonly subject: { readonly type: "exam_attempt"; readonly id: string };
}

class CustomerEnvironmentAccessError extends Error {
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>) {
    super(message);
    this.name = "CustomerEnvironmentAccessError";
    this.context = context;
  }
}

// --- Suspend ---

export interface SuspendHandlerDeps
  extends SuspendExamDeps,
    SupportDiagnosticDeps,
    EnvironmentCorrelationDeps,
    CompletionReconciliationDeps {}

export async function suspendExamAttemptRuntime(
  deps: SuspendHandlerDeps,
  request: SuspendResumeRuntimeRequest,
): Promise<SuspendResumeResponse> {
  const { examAttemptId } = request;
  const operationCorrelationId = (deps.newCorrelationId ?? randomUUID)();
  const sequenceAllocator = createCloudShareWorkflowSequenceAllocator();
  let anchors: RuntimeDiagnosticAnchors = {
    source: "runtime" as const,
    customerId: null as string | null,
    candidateEmail: deps.candidateEmail ?? null,
    examId: null as string | null,
    examAttemptId,
    correlationId: operationCorrelationId,
    actor: { type: "candidate" as const, id: null as string | null, email: deps.candidateEmail ?? null },
    subject: { type: "exam_attempt" as const, id: examAttemptId },
  };

  try {
    const settlement = await settleExamAttemptCompletion(
      {
        attempts: deps.attempts,
        exams: deps.exams,
        clocks: deps.clocks,
        diagnostics: deps.diagnostics,
        candidateEmail: deps.candidateEmail,
      },
      { examAttemptId },
    );
    if (settlement.kind === "not_found") {
      return { status: 404, body: { error: "exam attempt not found" } };
    }
    const reconciledAttempt = settlement.attempt;
    anchors = { ...anchorsForAttempt(reconciledAttempt, deps.candidateEmail), correlationId: operationCorrelationId };
    if (reconciledAttempt.status !== "in_progress" && !await deps.attempts.readRuntimeCommand?.(reconciledAttempt.customerId ?? "", examAttemptId)) {
      await deps.diagnostics?.record({
        ...anchors,
        level: "warn",
        operation: "exam_attempt.suspend",
        outcome: "failure",
        message: "Exam suspend failed",
        details: {
          failureMode: "invalid_status",
          expectedStatus: "in_progress",
          currentStatus: reconciledAttempt.status,
        },
      });
      return {
        status: 409,
        body: {
          error: "Exam attempt is not in a valid status for this transition",
          examAttemptId,
          operation: "suspend",
          expectedStatus: "in_progress",
          currentStatus: reconciledAttempt.status,
        },
      };
    }
    const correlation = await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId,
      operation: "exam_suspend",
      correlationId: operationCorrelationId,
      sequenceAllocator,
    });
    const commandResult = await suspendExam(
      {
        ...deps,
        ...(await resolveCustomerEnvironmentAccess(deps, examAttemptId, operationCorrelationId, sequenceAllocator)),
      },
      {
        examAttemptId,
        verifiedEnvironmentExternalId: await requireVerifiedEnvironmentExternalId(
          deps,
          examAttemptId,
          correlation.actionableEnvironmentId,
        ),
      },
    );
    await deps.diagnostics?.record({
      ...anchors,
      ...commandResultToDiagnostic(commandResult),
      level: "info",
      operation: "exam_attempt.suspend",
      outcome: "success",
      message: "Exam suspended",
    });
    deps.logger.info("exam suspended", {
      examAttemptId,
      customerId: anchors.customerId,
      examId: anchors.examId,
      candidateEmail: anchors.candidateEmail,
    });
    return { status: 200, body: { status: "suspended", examAttemptId } };
  } catch (err) {
    const resp = await handleExamAttemptRuntimeError(deps, err, "suspend", examAttemptId, anchors, operationCorrelationId);
    if (resp.status !== 200) {
      const correlationId =
        typeof resp.body.correlationId === "string" ? resp.body.correlationId : undefined;
      await deps.diagnostics?.record({
        ...anchors,
        ...(correlationId ? { correlationId } : {}),
        level: "warn",
        operation: "exam_attempt.suspend",
        outcome: "failure",
        message: "Exam suspend failed",
        details: {
          error: err instanceof Error ? err.message : String(err),
          ...(correlationId ? { correlationId } : {}),
          ...extractRuntimeFailureDetails(err, "suspend", examAttemptId),
        },
      });
    }
    return resp;
  }
}

// --- Resume ---

export interface ResumeHandlerDeps
  extends ResumeExamDeps,
    SupportDiagnosticDeps,
    EnvironmentCorrelationDeps,
    CompletionReconciliationDeps {}

export interface HeartbeatAutoSuspendHandlerDeps
  extends SuspendExamDeps,
    SupportDiagnosticDeps,
    EnvironmentCorrelationDeps,
    CompletionReconciliationDeps {}

export async function resumeExamAttemptRuntime(
  deps: ResumeHandlerDeps,
  request: SuspendResumeRuntimeRequest,
): Promise<SuspendResumeResponse> {
  const operationCorrelationId = (deps.newCorrelationId ?? randomUUID)();
  const sequenceAllocator = createCloudShareWorkflowSequenceAllocator();
  const { examAttemptId } = request;
  let anchors: RuntimeDiagnosticAnchors = {
    source: "runtime" as const,
    customerId: null as string | null,
    candidateEmail: deps.candidateEmail ?? null,
    examId: null as string | null,
    examAttemptId,
    correlationId: operationCorrelationId,
    actor: { type: "candidate" as const, id: null as string | null, email: deps.candidateEmail ?? null },
    subject: { type: "exam_attempt" as const, id: examAttemptId },
  };

  try {
    const settlement = await settleExamAttemptCompletion(
      {
        attempts: deps.attempts,
        exams: deps.exams,
        clocks: deps.clocks,
        diagnostics: deps.diagnostics,
        candidateEmail: deps.candidateEmail,
      },
      { examAttemptId },
    );
    if (settlement.kind === "not_found") {
      return { status: 404, body: { error: "exam attempt not found" } };
    }
    const reconciledAttempt = settlement.attempt;
    anchors = { ...anchorsForAttempt(reconciledAttempt, deps.candidateEmail), correlationId: operationCorrelationId };
    const resumeOpenPeriodEnd = await getResumeOpenPeriodEnd(deps, reconciledAttempt);
    const now = (deps.now ?? (() => new Date()))();
    const authoredOpenPeriodClosed = !!resumeOpenPeriodEnd && now.getTime() >= resumeOpenPeriodEnd.getTime();
    if (reconciledAttempt.status === "in_progress" && !await deps.attempts.readRuntimeCommand?.(reconciledAttempt.customerId ?? "", examAttemptId)) {
      const launch = await deps.launches.findByExamAttemptId(examAttemptId);
      return buildAlreadyActiveResumeResponse(deps, examAttemptId, anchors, launch, {
        currentStatus: reconciledAttempt.status,
        recoveryReason: "attempt_already_in_progress",
      });
    }
    if (reconciledAttempt.status !== "suspended" && !await deps.attempts.readRuntimeCommand?.(reconciledAttempt.customerId ?? "", examAttemptId)) {
      await deps.diagnostics?.record({
        ...anchors,
        level: "warn",
        operation: "exam_attempt.resume",
        outcome: "failure",
        message: "Exam resume failed",
        details: {
          failureMode: "invalid_status",
          expectedStatus: "suspended",
          currentStatus: reconciledAttempt.status,
        },
      });
      return {
        status: 409,
        body: {
          error: "Exam attempt is not in a valid status for this transition",
          examAttemptId,
          operation: "resume",
          expectedStatus: "suspended",
          currentStatus: reconciledAttempt.status,
        },
      };
    }
    const correlation = await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId,
      operation: "exam_resume",
      correlationId: operationCorrelationId,
      sequenceAllocator,
    });
    if (!resumeOpenPeriodEnd || authoredOpenPeriodClosed) {
      const externalLease = await inspectExamAttemptExternalLease(deps, {
        examAttemptId,
        customerId: reconciledAttempt.customerId ?? null,
        environmentExternalId: correlation.actionableEnvironmentId,
        correlationId: operationCorrelationId,
        sequenceAllocator,
      });
      await recordExamAttemptExternalLeaseInspectionFailure(deps, {
        inspection: externalLease,
        customerId: reconciledAttempt.customerId ?? null,
        examId: reconciledAttempt.examId,
        candidateId: reconciledAttempt.candidateId,
        candidateEmail: deps.candidateEmail ?? null,
        source: "runtime",
        actorType: "candidate",
        message: "CloudShare external lease inspection failed during exam resume",
        correlationId: operationCorrelationId,
      });
      if (externalLease.kind === "expired") {
        await reconcileExpiredExamAttemptExternalLease(deps, {
          inspection: externalLease,
          customerId: reconciledAttempt.customerId ?? null,
          examId: reconciledAttempt.examId,
          candidateId: reconciledAttempt.candidateId,
          candidateEmail: deps.candidateEmail ?? null,
          source: "runtime",
          actorType: "candidate",
          message: "ExamAttempt expired from authoritative CloudShare external lease reconciliation",
          correlationId: operationCorrelationId,
        });
        await deps.diagnostics?.record({
          ...anchors,
          level: "warn",
          operation: "exam_attempt.resume",
          outcome: "failure",
          message: "Exam resume failed: CloudShare lab has expired",
          externalIds: {
            ...(externalLease.trainingId ? { trainingId: externalLease.trainingId } : {}),
            ...(externalLease.environmentExternalId
              ? { environmentExternalId: externalLease.environmentExternalId }
              : {}),
          },
          request: externalLease.request
            ? {
                method: externalLease.request.method,
                path: externalLease.request.path,
                ...(externalLease.request.query ? { query: externalLease.request.query } : {}),
                ...(externalLease.request.headers ? { headers: externalLease.request.headers } : {}),
                ...(externalLease.request.body !== undefined
                  ? { body: externalLease.request.body }
                  : {}),
              }
            : null,
          response: externalLease.response
            ? {
                status: externalLease.response.status,
                ...(externalLease.response.headers
                  ? { headers: externalLease.response.headers }
                  : {}),
                body: externalLease.response.body,
                ...(externalLease.response.network
                  ? { network: externalLease.response.network }
                  : {}),
                ...(externalLease.response.tls ? { tls: externalLease.response.tls } : {}),
              }
            : null,
          details: {
            failureMode: "external_lease_expired",
            currentStatus: "expired",
            environmentStatus: externalLease.environmentStatus,
          },
        });
        return {
          status: 409,
          body: {
            error: "Exam resume is not available because the CloudShare lab has expired.",
            examAttemptId,
            operation: "resume",
            currentStatus: "expired",
          },
        };
      }
    }
    if (authoredOpenPeriodClosed) {
      await deps.diagnostics?.record({
        ...anchors,
        level: "warn",
        operation: "exam_attempt.resume",
        outcome: "failure",
        message: "Exam resume failed: authored open period is closed",
        details: {
          failureMode: "open_period_closed",
          currentStatus: reconciledAttempt.status,
          scheduledFor: reconciledAttempt.scheduledFor?.toISOString() ?? null,
          openPeriodEndsAt: resumeOpenPeriodEnd.toISOString(),
        },
      });
      return {
        status: 409,
        body: {
          error: "Exam resume is not available after the Exam open period has closed.",
          examAttemptId,
          operation: "resume",
          currentStatus: reconciledAttempt.status,
          openPeriodEndsAt: resumeOpenPeriodEnd.toISOString(),
        },
      };
    }
    const result = await resumeExam(
      {
        ...deps,
        ...(await resolveCustomerEnvironmentAccess(deps, examAttemptId, operationCorrelationId, sequenceAllocator)),
      },
      {
        examAttemptId,
        verifiedEnvironmentExternalId: await requireVerifiedEnvironmentExternalId(
          deps,
          examAttemptId,
          correlation.actionableEnvironmentId,
        ),
      },
    );
    await deps.diagnostics?.record({
      ...anchors,
      ...commandResultToDiagnostic(result.commandResult),
      level: "info",
      operation: "exam_attempt.resume",
      outcome: "success",
      message: "Exam resumed",
    });
    deps.logger.info("exam resumed", {
      examAttemptId,
      customerId: anchors.customerId,
      examId: anchors.examId,
      candidateEmail: anchors.candidateEmail,
    });
    return {
      status: 200,
      body: {
        status: "resumed",
        resumeDisposition: "resumed" satisfies ResumeDisposition,
        examAttemptId,
        suspendedPreservationLimitMs: result.suspendedPreservationLimitMs,
      },
    };
  } catch (err) {
    const recovered = await tryRecoverAlreadyActiveResume(deps, examAttemptId, anchors, err, operationCorrelationId, sequenceAllocator);
    if (recovered) {
      return recovered;
    }
    const resp = await handleExamAttemptRuntimeError(deps, err, "resume", examAttemptId, anchors, operationCorrelationId);
    if (resp.status !== 200) {
      const correlationId =
        typeof resp.body.correlationId === "string" ? resp.body.correlationId : undefined;
      await deps.diagnostics?.record({
        ...anchors,
        ...(correlationId ? { correlationId } : {}),
        level: "warn",
        operation: "exam_attempt.resume",
        outcome: "failure",
        message: "Exam resume failed",
        details: {
          error: err instanceof Error ? err.message : String(err),
          ...(correlationId ? { correlationId } : {}),
          ...extractRuntimeFailureDetails(err, "resume", examAttemptId),
        },
      });
    }
    return resp;
  }
}

async function getResumeOpenPeriodEnd(
  deps: Pick<ResumeHandlerDeps, "exams" | "now">,
  attempt: {
    readonly examId: string;
    readonly scheduledFor?: Date | null;
    readonly status: string;
  },
): Promise<Date | null> {
  if (!deps.exams || !attempt.scheduledFor) {
    return null;
  }
  if (attempt.status !== "in_progress" && attempt.status !== "suspended") {
    return null;
  }

  const exam = await deps.exams.findById(attempt.examId);
  if (!exam) {
    return null;
  }

  return new Date(attempt.scheduledFor.getTime() + exam.openPeriodMinutes * 60_000);
}

export async function runHeartbeatAutoSuspendRuntime(
  deps: HeartbeatAutoSuspendHandlerDeps,
  examAttemptId: string,
): Promise<void> {
  const operationCorrelationId = (deps.newCorrelationId ?? randomUUID)();
  const sequenceAllocator = createCloudShareWorkflowSequenceAllocator();
  const attempt = await deps.attempts.findById(examAttemptId);
  const anchors = {
    source: "runtime" as const,
    customerId: attempt?.customerId ?? null,
    candidateEmail: deps.candidateEmail ?? null,
    examId: attempt?.examId ?? null,
    examAttemptId,
    correlationId: operationCorrelationId,
    actor: { type: "candidate" as const, id: attempt?.candidateId ?? null, email: deps.candidateEmail ?? null },
    subject: { type: "exam_attempt" as const, id: examAttemptId },
  };
  try {
    const correlation = await ensureExamAttemptEnvironmentCorrelation(deps, {
      examAttemptId,
      operation: "heartbeat_auto_suspend",
      correlationId: operationCorrelationId,
      sequenceAllocator,
    });
    const commandResult = await suspendExam(
      {
        ...deps,
        ...(await resolveCustomerEnvironmentAccess(deps, examAttemptId, operationCorrelationId, sequenceAllocator)),
      },
      {
        examAttemptId,
        verifiedEnvironmentExternalId: await requireVerifiedEnvironmentExternalId(
          deps,
          examAttemptId,
          correlation.actionableEnvironmentId,
        ),
      },
    );
    await deps.diagnostics?.record({
      ...anchors,
      ...commandResultToDiagnostic(commandResult),
      level: "info",
      operation: "exam_attempt.heartbeat_auto_suspend",
      outcome: "success",
      message: "Exam auto-suspended by heartbeat expiry",
    });
  } catch (err) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.heartbeat_auto_suspend",
      outcome: "failure",
      message: "Heartbeat auto-suspend failed",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    await reportFailureDiagnostic(
      deps,
      err,
      examAttemptId,
      anchors,
      {
        action: "suspend",
        operation: "heartbeat_auto_suspend",
        eventType: "cloudshare.heartbeat_auto_suspend.failed",
        logMessage: "heartbeat auto-suspend failed",
      },
      operationCorrelationId,
    );
    throw err;
  }
}

// --- Helpers ---

function commandResultToDiagnostic(
  commandResult: EnvironmentCommandResult,
): Pick<RuntimeDiagnosticAnchors, never> & {
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
      ...(commandResult.host ? { host: commandResult.host } : {}),
    },
  };
}

async function resolveCustomerEnvironmentAccess(
  deps: SuspendHandlerDeps | ResumeHandlerDeps | HeartbeatAutoSuspendHandlerDeps,
  examAttemptId: string,
  correlationId: string,
  sequenceAllocator: CloudShareWorkflowSequenceAllocator,
): Promise<Pick<SuspendExamDeps, "controller" | "source" | "isDefiniteCommandRejection">> {
  const attempt = await deps.attempts.findById(examAttemptId);
  if (!attempt?.customerId) {
    throw new CustomerEnvironmentAccessError(
      "Exam attempt is missing a Customer CloudShare connection binding.",
      { examAttemptId },
    );
  }

  const connection = await deps.connections.findByCustomerId(attempt.customerId);
  if (!connection) {
    throw new CustomerEnvironmentAccessError(
      "No stored CloudShare connection exists for the exam attempt customer.",
      {
        examAttemptId,
        customerId: attempt.customerId,
      },
    );
  }

  const client = deps.cloudshare.forConnection(connection, certificationCloudShareWorkflow({ actor: { type: "system", id: "exam-runtime" }, customerId: attempt.customerId, subject: { type: "exam_attempt", id: examAttemptId }, correlationId, source: "runtime", examId: attempt.examId ?? undefined, examAttemptId, sequenceAllocator, externalIds: { lifecycleParent: `exam-runtime:${examAttemptId}` } }));
  return {
    controller: createCloudShareEnvironmentController(client),
    isDefiniteCommandRejection: error => error instanceof CloudShareRequestError && [400, 401, 403, 404, 429].includes(error.status),
    source: createCloudShareEnvironmentSource(client),
  };
}

async function requireVerifiedEnvironmentExternalId(
  deps: Pick<SuspendHandlerDeps | ResumeHandlerDeps | HeartbeatAutoSuspendHandlerDeps, "launches">,
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

async function tryRecoverAlreadyActiveResume(
  deps: ResumeHandlerDeps,
  examAttemptId: string,
  anchors: RuntimeDiagnosticAnchors,
  err: unknown,
  operationCorrelationId: string,
  sequenceAllocator: CloudShareWorkflowSequenceAllocator,
): Promise<SuspendResumeResponse | null> {
  if (!isCloudShareFailure(err)) {
    return null;
  }

  try {
    const launch = await deps.launches.findByExamAttemptId(examAttemptId);
    if (!launch) {
      return null;
    }

    const access = await resolveCustomerEnvironmentAccess(deps, examAttemptId, operationCorrelationId, sequenceAllocator);
    const environmentExternalId =
      launch.environmentExternalId ?? launch.environmentId ?? null;
    if (!environmentExternalId) {
      return null;
    }

    const snapshot = await access.source.getEnvironmentState(environmentExternalId);
    if (!snapshot || (snapshot.status !== "running" && snapshot.status !== "created")) {
      return null;
    }

    const attempt = await deps.attempts.findById(examAttemptId);
    const pending = await deps.attempts.readRuntimeCommand?.(attempt?.customerId ?? "", examAttemptId);
    if (!pending || pending.action !== "resume" || pending.environmentId !== environmentExternalId) return null;
    if (!await deps.attempts.settleRuntimeCommand?.(pending, (deps.now ?? (() => new Date()))())) return null;

    return buildAlreadyActiveResumeResponse(deps, examAttemptId, anchors, launch, {
      currentStatus: attempt?.status ?? "suspended",
      environmentStatus: snapshot.status,
      recoveryReason: "cloudshare_reported_already_active",
      supportContext: extractRuntimeFailureDetails(err, "resume", examAttemptId),
    });
  } catch {
    return null;
  }
}

async function buildAlreadyActiveResumeResponse(
  deps: Pick<ResumeHandlerDeps, "diagnostics" | "logger">,
  examAttemptId: string,
  anchors: RuntimeDiagnosticAnchors,
  launch:
    | {
        readonly environmentExternalId?: string;
        readonly environmentId?: string;
        readonly trainingId?: string;
        readonly experienceId?: string;
      }
    | null,
  input: {
    readonly currentStatus: string;
    readonly recoveryReason: string;
    readonly environmentStatus?: string;
    readonly supportContext?: Record<string, unknown>;
  },
): Promise<SuspendResumeResponse> {
  const environmentExternalId =
    launch?.environmentExternalId ?? launch?.environmentId ?? undefined;
  await deps.diagnostics?.record({
    ...anchors,
    level: "info",
    operation: "exam_attempt.resume",
    outcome: "success",
    message: "Exam resume requested while already active",
    externalIds: {
      ...(environmentExternalId ? { environmentId: environmentExternalId } : {}),
      ...(launch?.trainingId ? { trainingId: launch.trainingId } : {}),
      ...(launch?.experienceId ? { experienceId: launch.experienceId } : {}),
    },
    details: {
      idempotent: true,
      currentStatus: input.currentStatus,
      resumeDisposition: "already_active",
      recoveryReason: input.recoveryReason,
      ...(input.environmentStatus ? { environmentStatus: input.environmentStatus } : {}),
      ...(input.supportContext ? { supportContext: input.supportContext } : {}),
    },
  });
  deps.logger.info("exam resume returned idempotent success", {
    examAttemptId,
    customerId: anchors.customerId,
    examId: anchors.examId,
    candidateEmail: anchors.candidateEmail,
    recoveryReason: input.recoveryReason,
  });
  return {
    status: 200,
    body: {
      status: "resumed",
      resumeDisposition: "already_active" satisfies ResumeDisposition,
      examAttemptId,
      suspendedPreservationLimitMs: SUSPENDED_PRESERVATION_LIMIT_MS,
    },
  };
}

async function handleExamAttemptRuntimeError(
  deps: SupportDiagnosticDeps,
  err: unknown,
  action: "suspend" | "resume",
  examAttemptId: string,
  anchors?: Pick<RuntimeDiagnosticAnchors, "customerId" | "candidateEmail" | "examId">,
  operationCorrelationId?: string,
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
    anchors,
    {
      action,
      operation: `exam_${action}`,
      eventType: `cloudshare.exam_${action}.failed`,
      logMessage: `exam ${action} failed`,
    },
    operationCorrelationId,
  );
  if (failure) {
    return failure;
  }

  const correlationId = operationCorrelationId ?? (deps.newCorrelationId ?? randomUUID)();
  const diagnostic = {
    correlationId,
    examAttemptId,
    customerId: anchors?.customerId ?? null,
    examId: anchors?.examId ?? null,
    candidateEmail: anchors?.candidateEmail ?? null,
    operation: `exam_${action}`,
    attemptedOperation: `${action}_exam`,
    failureMode: "unexpected_internal_error",
    error: err instanceof Error ? err.message : String(err),
  };
  await appendRuntimeEvent(deps, anchors, correlationId, `cloudshare.exam_${action}.failed`, diagnostic);
  deps.logger.error(`exam ${action} errored`, projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>);
  return { status: 500, body: { error: "internal error", correlationId } };
}

async function reportFailureDiagnostic(
  deps: SupportDiagnosticDeps,
  err: unknown,
  examAttemptId: string,
  anchors: Pick<RuntimeDiagnosticAnchors, "customerId" | "candidateEmail" | "examId"> | undefined,
  spec: FailureHandlingSpec,
  operationCorrelationId?: string,
): Promise<SuspendResumeResponse | null> {
  if (err instanceof CustomerEnvironmentAccessError) {
    const correlationId = operationCorrelationId ?? (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = {
      correlationId,
      examAttemptId,
      customerId: anchors?.customerId ?? null,
      examId: anchors?.examId ?? null,
      candidateEmail: anchors?.candidateEmail ?? null,
      operation: spec.operation,
      attemptedOperation: "load_customer_cloudshare_connection",
      integrationSurface: "cloudshare.connection",
      failureMode: "missing_customer_connection",
      error: err.message,
      ...err.context,
    };
    await appendRuntimeEvent(deps, anchors, correlationId, spec.eventType, diagnostic);
    deps.logger.warn(spec.logMessage, projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>);
    return { status: 502, body: { error: `exam ${spec.action} failed`, correlationId } };
  }

  if (err instanceof ExamAttemptRuntimeError) {
    const correlationId = operationCorrelationId ?? (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = buildExamAttemptRuntimeDiagnostic(
      correlationId,
      spec.action,
      spec.operation,
      examAttemptId,
      err,
      anchors,
    );
    await appendRuntimeEvent(deps, anchors, correlationId, spec.eventType, diagnostic);
    deps.logger.warn(spec.logMessage, projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>);
    if (isCloudShareRateLimitError(err.context?.cause)) {
      return {
        status: 429,
        body: {
          error: CLOUDSHARE_429_CANDIDATE_MESSAGE,
          correlationId,
        },
      };
    }
    return (
      buildPendingTransitionResponse(spec.action, examAttemptId, err, correlationId) ?? {
        status: 502,
        body: { error: `exam ${spec.action} failed`, correlationId },
      }
    );
  }

  if (isCloudShareFailure(err)) {
    const correlationId = operationCorrelationId ?? (deps.newCorrelationId ?? randomUUID)();
    const diagnostic = buildCloudShareDiagnostic(
      correlationId,
      spec.action,
      spec.operation,
      examAttemptId,
      err,
      anchors,
    );
    await appendRuntimeEvent(deps, anchors, correlationId, spec.eventType, diagnostic);
    deps.logger.warn(spec.logMessage, projectCloudShareGenericLogValue(diagnostic) as Record<string, unknown>);
    return {
      status: isCloudShareRateLimitError(err) ? 429 : 502,
      body: {
        error: isCloudShareRateLimitError(err)
          ? CLOUDSHARE_429_CANDIDATE_MESSAGE
          : `exam ${spec.action} failed`,
        correlationId,
      },
    };
  }

  return null;
}

async function appendRuntimeEvent(
  deps: SupportDiagnosticDeps,
  anchors: Pick<RuntimeDiagnosticAnchors, "customerId" | "candidateEmail" | "examId"> | undefined,
  correlationId: string,
  type: string,
  diagnostic: Record<string, unknown>,
): Promise<void> {
  if (!anchors?.customerId) return;
  const examAttemptId = typeof diagnostic.examAttemptId === "string"
    ? diagnostic.examAttemptId
    : undefined;
  await deps.eventLog.append({
    eventId: correlationId,
    customerId: anchors.customerId,
    correlationId,
    type,
    occurredAt: (deps.now ?? (() => new Date()))(),
    payload: projectEventLogMetadata({
      ...diagnostic,
      operation: typeof diagnostic.operation === "string" ? diagnostic.operation : type,
      outcome: "failure",
      actor: {
        type: "candidate",
        ...(anchors.candidateEmail ? { email: anchors.candidateEmail } : {}),
      },
      externalIds: {
        ...(examAttemptId ? { examAttemptId } : {}),
        ...(anchors.examId ? { examId: anchors.examId } : {}),
        ...(typeof diagnostic.environmentId === "string"
          ? { environmentId: diagnostic.environmentId }
          : {}),
        ...(typeof diagnostic.environmentExternalId === "string"
          ? { environmentExternalId: diagnostic.environmentExternalId }
          : {}),
        ...(typeof diagnostic.trainingId === "string" ? { trainingId: diagnostic.trainingId } : {}),
      },
    }),
  });
}

function buildPendingTransitionResponse(
  action: "suspend" | "resume",
  examAttemptId: string,
  err: ExamAttemptRuntimeError,
  correlationId: string,
): PendingTransitionResponseSpec | null {
  const failureMode =
    typeof err.context?.failureMode === "string"
      ? err.context.failureMode
      : /^Timed out waiting for environment to become /i.test(err.message)
        ? "confirmation_timeout"
        : null;
  if (failureMode !== "confirmation_timeout" && failureMode !== "not_correlated_yet" && failureMode !== "runtime_command_pending") {
    return null;
  }

  return {
    status: 202,
    body: {
      status: "pending",
      operation: action,
      examAttemptId,
      retryable: true,
      correlationId,
      message:
        action === "resume"
          ? "CloudShare is still resuming your lab. Wait a few seconds, then retry Resume exam."
          : "CloudShare is still suspending your lab. Wait a few seconds, then retry Suspend lab.",
    },
  };
}

function buildExamAttemptRuntimeDiagnostic(
  correlationId: string,
  _action: "suspend" | "resume",
  operation: string,
  examAttemptId: string,
  err: ExamAttemptRuntimeError,
  anchors?: Pick<RuntimeDiagnosticAnchors, "customerId" | "candidateEmail" | "examId">,
): Record<string, unknown> {
  if (err.context?.failureMode === "not_correlated_yet") {
    return {
      correlationId,
      examAttemptId,
      customerId: anchors?.customerId ?? null,
      examId: anchors?.examId ?? null,
      candidateEmail: anchors?.candidateEmail ?? null,
      operation,
      attemptedOperation: err.context?.attemptedOperation ?? "resolve_environment_correlation",
      integrationSurface:
        err.context?.integrationSurface ?? "cloudshare.v4.training.participant_list",
      method: err.context?.method ?? "GET",
      path:
        typeof err.context?.path === "string"
          ? err.context.path
          : "/v4/trainings/{trainingId}/students",
      failureMode: "not_correlated_yet",
      error: err.message,
      ...(err.context ?? {}),
    };
  }

  return {
    correlationId,
    examAttemptId,
    customerId: anchors?.customerId ?? null,
    examId: anchors?.examId ?? null,
    candidateEmail: anchors?.candidateEmail ?? null,
    operation,
    attemptedOperation: "poll_environment_status",
    integrationSurface: "cloudshare.v4.environments.get",
    method: "GET",
    path:
      typeof err.context?.environmentExternalId === "string"
        ? `/v4/environments/${err.context.environmentExternalId}`
        : "/v4/environments/{environmentId}",
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
  anchors?: Pick<RuntimeDiagnosticAnchors, "customerId" | "candidateEmail" | "examId">,
): Record<string, unknown> {
  const staticSpec =
    action === "suspend"
      ? {
          attemptedOperation: "suspend_environment",
          integrationSurface: "cloudshare.v4.environments.suspend",
          method: "POST",
          path:
            typeof err.context?.environmentExternalId === "string"
              ? `/v4/environments/${encodeURIComponent(err.context.environmentExternalId)}/suspend`
              : "/v4/environments/{environmentId}/suspend",
        }
      : {
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v4.environments.resume",
          method: "POST",
          path:
            typeof err.context?.environmentExternalId === "string"
              ? `/v4/environments/${encodeURIComponent(err.context.environmentExternalId)}/resume`
              : "/v4/environments/{environmentId}/resume",
        };

  const base = {
    correlationId,
    examAttemptId,
    customerId: anchors?.customerId ?? null,
    examId: anchors?.examId ?? null,
    candidateEmail: anchors?.candidateEmail ?? null,
    operation,
    attemptedOperation: staticSpec.attemptedOperation,
    integrationSurface: err.context?.integrationSurface ?? staticSpec.integrationSurface,
    method: err.context?.method ?? staticSpec.method,
    path: err.context?.path ?? staticSpec.path,
    host: err.context?.host,
  };

  if (isCloudShareRateLimitError(err)) {
    return {
      ...base,
      failureMode: "rate_limit",
      responseStatus: err.status,
      requestHeaders: err.context?.requestHeaders,
      requestBody: err.context?.requestBody,
      responseHeaders: err.context?.responseHeaders,
      responseBody: err.context?.responseBody,
      network: err.context?.network,
      tls: err.context?.tls,
    };
  }

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
    isCloudShareRateLimitError(err) ||
    err instanceof CloudShareRequestError ||
    err instanceof CloudShareTransportError ||
    err instanceof CloudShareResponseError
  );
}

function anchorsForAttempt(
  attempt: {
    readonly id: string;
    readonly customerId?: string;
    readonly candidateId: string;
    readonly examId: string;
  },
  candidateEmail?: string,
): RuntimeDiagnosticAnchors {
  return {
    source: "runtime",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId ?? null,
    examAttemptId: attempt.id,
    correlationId: null,
    actor: { type: "candidate", id: attempt.candidateId ?? null, email: candidateEmail ?? null },
    subject: { type: "exam_attempt", id: attempt.id },
  };
}

function extractRuntimeFailureDetails(
  err: unknown,
  action: "suspend" | "resume",
  examAttemptId: string,
): Record<string, unknown> {
  if (err instanceof CustomerEnvironmentAccessError) {
    return {
      attemptedOperation: "load_customer_cloudshare_connection",
      integrationSurface: "cloudshare.connection",
      failureMode: "missing_customer_connection",
    };
  }
  if (err instanceof InvalidExamAttemptStatusError) {
    return {
      failureMode: "invalid_status",
      expectedStatus: err.context?.expectedStatus,
      currentStatus: err.context?.currentStatus,
    };
  }
  if (err instanceof ExamAttemptRuntimeError) {
    return stripDiagnosticEnvelope(
      buildExamAttemptRuntimeDiagnostic("", action, `exam_${action}`, examAttemptId, err),
    );
  }
  if (isCloudShareFailure(err)) {
    return stripDiagnosticEnvelope(
      buildCloudShareDiagnostic("", action, `exam_${action}`, examAttemptId, err),
    );
  }
  return {};
}

function stripDiagnosticEnvelope(
  diagnostic: Record<string, unknown>,
): Record<string, unknown> {
  const {
    correlationId: _correlationId,
    examAttemptId: _examAttemptId,
    customerId: _customerId,
    examId: _examId,
    candidateEmail: _candidateEmail,
    operation: _operation,
    ...rest
  } = diagnostic;
  return rest;
}
