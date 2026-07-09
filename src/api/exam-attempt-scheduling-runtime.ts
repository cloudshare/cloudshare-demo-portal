import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EventLogRepository } from "@/domain/event-log";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import { isIndividualExamDeliveryAvailable, type ExamRepository } from "@/domain/exam-catalog";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  CloudShareProvisioningError,
  ScheduleExamNotFoundError,
  ScheduleOverlapError,
  ScheduleValidationError,
  scheduleExam,
} from "@/domain/scheduling";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import {
  createCloudShareLabProvisioner,
  type CloudShareLabProvisionerObserver,
} from "@/integrations/cloudshare/labs";
import type { Logger } from "@/observability/logger";
import { guardRuntimeBlueprintSnapshot } from "./runtime-blueprint-snapshot-guard";

export interface ExamAttemptSchedulingRuntimeDeps {
  readonly exams: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly audit: AuditRepository;
  readonly eventLog: EventLogRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly logger: Logger;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface ExamAttemptSchedulingRuntimeRequest {
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName?: string | null;
  readonly candidateLastName?: string | null;
  readonly examId: string;
  readonly scheduledFor: string;
}

export interface ExamAttemptSchedulingRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function scheduleExamAttemptRuntime(
  deps: ExamAttemptSchedulingRuntimeDeps,
  request: ExamAttemptSchedulingRuntimeRequest,
): Promise<ExamAttemptSchedulingRuntimeResponse> {
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const exam = await deps.exams.findById(request.examId);
  if (
    !exam ||
    exam.customerId !== request.customerId ||
    exam.status !== "published" ||
    !isIndividualExamDeliveryAvailable(exam)
  ) {
    return { status: 404, body: { error: "Published exam not found." } };
  }

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return {
      status: 409,
      body: { error: "CloudShare is not connected for this customer." },
    };
  }

  if (
    !request.candidateFirstName?.trim() ||
    !request.candidateLastName?.trim() ||
    request.candidateFirstName.trim().length < 2 ||
    request.candidateLastName.trim().length < 2
  ) {
    return {
      status: 409,
      body: {
        error:
          "Candidate first name and last name are required before scheduling an Exam.",
      },
    };
  }

  const scheduledFor = new Date(request.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    return {
      status: 400,
      body: { error: "Choose a valid date and time before scheduling." },
    };
  }
  if (scheduledFor.getTime() <= (deps.now ?? (() => new Date()))().getTime()) {
    return {
      status: 400,
      body: { error: "Choose a future date and time before scheduling." },
    };
  }

  const overlap = await findSameExamAvailabilityOverlap({
    attempts: deps.attempts,
    candidateId: request.candidateId,
    examId: exam.id,
    scheduledFor,
    availabilityWindowMinutes: exam.storageLeaseMinutes ?? exam.openPeriodMinutes,
  });
  if (overlap) {
    return {
      status: 409,
      body: {
        error:
          `Another attempt for this Exam is still active or available. ` +
          `You can schedule this Exam again after ${overlap.nextAvailableAt.toISOString()}.`,
        code: "exam_attempt_overlap",
        nextAvailableAt: overlap.nextAvailableAt.toISOString(),
      },
    };
  }

  const cloudshare = deps.cloudshare.forConnection(connection);
  const snapshotGuardFailure = await guardRuntimeBlueprintSnapshot(deps, {
    source: "candidate-portal",
    operation: "exam_attempt.schedule",
    correlationId,
    customerId: request.customerId,
    examId: exam.id,
    candidateId: request.candidateId,
    candidateEmail: request.candidateEmail,
    actor: {
      type: "candidate",
      id: request.candidateId,
      email: request.candidateEmail,
    },
    subject: { type: "exam", id: exam.id },
    projectId: exam.projectId,
    blueprintId: exam.blueprintId,
    savedSnapshotId: exam.snapshotId,
  });
  if (snapshotGuardFailure) {
    return {
      status: snapshotGuardFailure.status,
      body: {
        error:
          snapshotGuardFailure.status === 429
            ? "Exam scheduling is temporarily unavailable because CloudShare is rate limiting requests. Wait a moment, then try again."
            : "Exam scheduling is temporarily unavailable because the lab configuration changed. Contact your instructor.",
        correlationId,
      },
    };
  }

  const labs = createCloudShareLabProvisioner(
    cloudshare,
    createTeamReadDiagnosticObserver({
      diagnostics: deps.diagnostics,
      customerId: request.customerId,
      candidateId: request.candidateId,
      candidateEmail: request.candidateEmail,
      examId: request.examId,
      correlationId,
    }),
  );

  try {
    const result = await scheduleExam(
      {
        exams: deps.exams,
        attempts: deps.attempts,
        launches: deps.launches,
        labs,
        newId: deps.newId ?? randomUUID,
        now: deps.now ?? (() => new Date()),
        diagnostics: deps.diagnostics,
      },
      {
        customerId: request.customerId,
        candidateId: request.candidateId,
        candidateEmail: request.candidateEmail,
        candidateFirstName: request.candidateFirstName.trim(),
        candidateLastName: request.candidateLastName.trim(),
        examId: request.examId,
        scheduledFor,
        correlationId,
      },
    );

    deps.logger.info("candidate exam scheduled", {
      correlationId,
      customerId: request.customerId,
      operation: "schedule_exam",
      candidateId: request.candidateId,
      examId: result.attempt.examId,
      examAttemptId: result.attempt.id,
      scheduledFor: result.attempt.scheduledFor,
      attemptStatus: result.attempt.status,
      coldStartLikely: result.coldStartLikely,
    });
    await deps.audit.write({
      id: `${result.attempt.id}:lab_launched:${correlationId}`,
      customerId: request.customerId,
      actorType: "candidate",
      actorId: request.candidateId,
      subjectType: "exam_attempt",
      subjectId: result.attempt.id,
      examAttemptId: result.attempt.id,
      candidateId: request.candidateId,
      examId: result.attempt.examId,
      correlationId,
      action: "lab_launched",
      outcome: "success",
      details: {
        trainingId: result.trainingId,
        experienceId: result.experienceId,
      },
      occurredAt: deps.now?.() ?? new Date(),
    });

    return {
      status: 201,
      body: {
        attempt: result.attempt,
        coldStartLikely: result.coldStartLikely,
        correlationId,
      },
    };
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return {
        status: 400,
        body: { error: toCandidateScheduleValidationMessage(error) },
      };
    }
    if (error instanceof ScheduleExamNotFoundError) {
      return { status: 404, body: { error: "Published exam not found." } };
    }
    if (error instanceof ScheduleOverlapError) {
      return {
        status: 409,
        body: {
          error: toCandidateScheduleOverlapMessage(error),
          code: "exam_attempt_overlap",
          nextAvailableAt: error.nextAvailableAt.toISOString(),
        },
      };
    }
    if (error instanceof CloudShareProvisioningError) {
      const diagnostic: Record<string, unknown> = {
        correlationId,
        customerId: request.customerId,
        candidateId: request.candidateId,
        examAttemptId: error.context.attemptId,
        operation: "schedule_exam",
        ...toProvisioningDiagnostic(error),
      };
      await deps.eventLog.append({
        eventId: correlationId,
        type: "cloudshare.schedule_exam.failed",
        occurredAt: deps.now?.() ?? new Date(),
        payload: diagnostic,
      });
      await deps.audit.write({
        id: `${error.context.attemptId}:lab_launch_failed:${correlationId}`,
        customerId: request.customerId,
        actorType: "candidate",
        actorId: request.candidateId,
        subjectType: "exam_attempt",
        subjectId: error.context.attemptId,
        examAttemptId: error.context.attemptId,
        candidateId: request.candidateId,
        correlationId,
        action: "lab_launch_failed",
        outcome: "failure",
        details: {
          attemptedOperation: diagnostic.attemptedOperation,
          integrationSurface: diagnostic.integrationSurface,
          method: diagnostic.method,
          path: diagnostic.path,
          failureMode: diagnostic.failureMode,
          responseStatus: diagnostic.responseStatus,
          correlationId,
        },
        error: "CloudShare provisioning failed for the scheduled exam.",
        occurredAt: deps.now?.() ?? new Date(),
      });
      deps.logger.warn("candidate exam scheduling failed", diagnostic);
      return {
        status: isCloudShareRateLimitError(error.context.cause) ? 429 : 502,
        body: {
          error: isCloudShareRateLimitError(error.context.cause)
            ? "Exam scheduling is temporarily unavailable because CloudShare is rate limiting requests. Wait a moment, then try again."
            : "CloudShare provisioning failed for the scheduled exam.",
          correlationId,
        },
      };
    }
    throw error;
  }
}

function toCandidateScheduleValidationMessage(error: ScheduleValidationError): string {
  if (error.message === "scheduledFor must be in the future.") {
    return "Choose a future date and time before scheduling.";
  }
  if (error.message === "scheduledFor must be a valid datetime.") {
    return "Choose a valid date and time before scheduling.";
  }
  return error.message;
}

function toCandidateScheduleOverlapMessage(error: ScheduleOverlapError): string {
  return `Another attempt for this Exam is still active or available. You can schedule this Exam again after ${error.nextAvailableAt.toISOString()}.`;
}

async function findSameExamAvailabilityOverlap(input: {
  readonly attempts: ExamAttemptRepository;
  readonly candidateId: string;
  readonly examId: string;
  readonly scheduledFor: Date;
  readonly availabilityWindowMinutes: number;
}): Promise<{ readonly conflictingAttemptId: string; readonly nextAvailableAt: Date } | null> {
  const requestedAtMs = input.scheduledFor.getTime();
  const windowMs = input.availabilityWindowMinutes * 60_000;
  const requestedEndMs = requestedAtMs + windowMs;
  const existingAttempts = await input.attempts.listByCandidate(input.candidateId);

  for (const attempt of existingAttempts) {
    if (
      attempt.examId !== input.examId ||
      attempt.status === "completed" ||
      attempt.status === "expired" ||
      !attempt.scheduledFor
    ) {
      continue;
    }

    const windowStartMs = attempt.scheduledFor.getTime();
    if (!Number.isFinite(windowStartMs)) {
      continue;
    }
    const windowEndMs = windowStartMs + windowMs;
    if (requestedAtMs < windowEndMs && requestedEndMs > windowStartMs) {
      return {
        conflictingAttemptId: attempt.id,
        nextAvailableAt: new Date(windowEndMs),
      };
    }
  }

  return null;
}

function createTeamReadDiagnosticObserver(input: {
  diagnostics?: DiagnosticRecorder;
  customerId: string;
  candidateId: string;
  candidateEmail: string;
  examId: string;
  correlationId: string;
}): CloudShareLabProvisionerObserver | undefined {
  if (!input.diagnostics) {
    return undefined;
  }

  return {
    onTeamReadSuccess: async (event) => {
      await input.diagnostics?.record({
        source: "candidate-portal",
        customerId: input.customerId,
        candidateEmail: input.candidateEmail,
        examId: input.examId,
        correlationId: input.correlationId,
        actor: {
          type: "candidate",
          id: input.candidateId,
          email: input.candidateEmail,
        },
        subject: { type: "exam", id: input.examId },
        level: "info",
        operation: "cloudshare.resource_sync.teams.read",
        outcome: "success",
        message: "CloudShare team resource read succeeded",
        externalIds: {
          resourceType: "team",
          projectId: event.projectId,
          teamId: event.selectedTeamId,
        },
        request: { method: "GET", path: "/teams", query: { projectId: event.projectId } },
        response: { itemCount: event.itemCount, resourceIds: [...event.teamIds] },
        details: { integrationSurface: "cloudshare.v3.teams" },
      });
    },
    onTeamReadFailure: async (event) => {
      await input.diagnostics?.record({
        source: "candidate-portal",
        customerId: input.customerId,
        candidateEmail: input.candidateEmail,
        examId: input.examId,
        correlationId: input.correlationId,
        actor: {
          type: "candidate",
          id: input.candidateId,
          email: input.candidateEmail,
        },
        subject: { type: "exam", id: input.examId },
        level: "warn",
        operation: "cloudshare.resource_sync.teams.read",
        outcome: "failure",
        message: "CloudShare team resource read failed",
        externalIds: { resourceType: "team", projectId: event.projectId },
        request: { method: "GET", path: "/teams", query: { projectId: event.projectId } },
        response: {
          ...(event.responseStatus !== undefined ? { status: event.responseStatus } : {}),
        },
        details: {
          integrationSurface: event.integrationSurface,
          failureMode: event.failureMode,
        },
      });
    },
  };
}

function toProvisioningDiagnostic(
  error: CloudShareProvisioningError,
): Record<string, unknown> {
  const pathByOperation = {
    create_training: "/v4/trainings",
    add_participant: `/v4/trainings/${error.context.trainingId ?? "{trainingId}"}/students`,
    create_sponsored_link: `/v4/trainings/${error.context.trainingId ?? "{trainingId}"}/sponsored-link`,
  } as const;
  const integrationSurfaceByOperation = {
    create_training: "cloudshare.v4.training",
    add_participant: "cloudshare.v4.training.participant",
    create_sponsored_link: "cloudshare.v4.training.sponsored_link",
  } as const;

  const base = {
    attemptedOperation: error.context.attemptedOperation,
    integrationSurface: integrationSurfaceByOperation[error.context.attemptedOperation],
    method: "POST",
    path: pathByOperation[error.context.attemptedOperation],
  };

  const cause = error.context.cause;
  if (isCloudShareRateLimitError(cause) || cause instanceof CloudShareRequestError) {
    return {
      ...base,
      method: (cause as CloudShareRequestError).context?.method ?? base.method,
      path: (cause as CloudShareRequestError).context?.path ?? base.path,
      host: (cause as CloudShareRequestError).context?.host,
      integrationSurface: (cause as CloudShareRequestError).context?.integrationSurface ?? base.integrationSurface,
      failureMode:
        isCloudShareRateLimitError(cause) ? "rate_limit" : "http_status",
      responseStatus: (cause as CloudShareRequestError).status,
      requestHeaders: (cause as CloudShareRequestError).context?.requestHeaders,
      requestBody: (cause as CloudShareRequestError).context?.requestBody,
      responseHeaders: (cause as CloudShareRequestError).context?.responseHeaders,
      responseBody: (cause as CloudShareRequestError).context?.responseBody,
      network: (cause as CloudShareRequestError).context?.network,
      tls: (cause as CloudShareRequestError).context?.tls,
    };
  }
  if (cause instanceof CloudShareTransportError) {
    return {
      ...base,
      method: cause.context?.method ?? base.method,
      path: cause.context?.path ?? base.path,
      host: cause.context?.host,
      integrationSurface: cause.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "transport",
      requestHeaders: cause.context?.requestHeaders,
      requestBody: cause.context?.requestBody,
      cause: cause.context?.cause,
    };
  }
  if (cause instanceof CloudShareResponseError) {
    return {
      ...base,
      method: cause.context?.method ?? base.method,
      path: cause.context?.path ?? base.path,
      host: cause.context?.host,
      integrationSurface: cause.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "unexpected_response",
      requestHeaders: cause.context?.requestHeaders,
      requestBody: cause.context?.requestBody,
      responseHeaders: cause.context?.responseHeaders,
      responseBody: cause.context?.responseBody,
      network: cause.context?.network,
      tls: cause.context?.tls,
      issues: cause.context?.issues,
    };
  }
  return {
    ...base,
    failureMode: "unknown",
    error: cause instanceof Error ? cause.message : String(cause),
  };
}
