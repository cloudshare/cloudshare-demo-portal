import { isIndividualExamDeliveryAvailable, type ExamRepository } from "./exam-catalog";
import type { ExamAttemptRepository } from "./exam-attempt";
import {
  CandidateAdmissionConflictError,
  completeCandidateAdmission,
  recoverCandidateAdmissionAttempt,
  reserveCandidateAdmissionAttempt,
} from "./candidate-admission";
import type {
  LabLaunchRepository,
  IndividualTrainingDelivery,
  ProvisioningRequestEvidence,
  ProvisioningResponseEvidence,
} from "./lab-launch";
import { TrainingDeliveryOperationError } from "./lab-launch";
import type { DiagnosticRecorder } from "./diagnostic-log";

type ProvisioningOperation =
  | "create_training"
  | "ensure_user_properties"
  | "add_participant"
  | "create_sponsored_link";

const PROVISIONING_SURFACE: Record<ProvisioningOperation, string> = {
  create_training: "cloudshare.v4.training",
  ensure_user_properties: "cloudshare.v4.training.user_properties",
  add_participant: "cloudshare.v4.training.participant",
  create_sponsored_link: "cloudshare.v4.training.sponsored_link",
};

/**
 * Structural (non-CloudShare-coupled) summary of a provisioning failure cause.
 * Reads only plain error properties so the domain stays free of integration
 * imports. The CloudShare adapter retains body evidence in `context`; the
 * DiagnosticRecorder masks only the actual request-header slot.
 */
function describeProvisioningCause(cause: unknown): Record<string, unknown> {
  const err = cause as
    | { name?: string; status?: number; message?: string; context?: Record<string, unknown> }
    | undefined;
  const ctx = (err?.context ?? {}) as Record<string, unknown>;
  const failureMode =
    err?.name === "CloudShareRequestError"
      ? "http_status"
      : err?.name === "CloudShareTransportError"
        ? "transport"
        : err?.name === "CloudShareResponseError"
          ? "unexpected_response"
          : "unknown";
  return {
    failureMode,
    integrationSurface: ctx.integrationSurface ?? null,
    method: ctx.method ?? null,
    path: ctx.path ?? null,
    responseStatus:
      typeof err?.status === "number" ? err.status : (ctx.status ?? null),
    responseBody: ctx.responseBody ?? null,
    error: cause instanceof Error ? cause.message : String(cause),
  };
}

function extractProvisioningRequest(cause: unknown): Record<string, unknown> | undefined {
  const ctx = ((cause as { context?: Record<string, unknown> } | undefined)?.context ?? {}) as Record<
    string,
    unknown
  >;
  const method = ctx.method;
  const path = ctx.path;
  const requestHeaders = ctx.requestHeaders;
  const requestBody = ctx.requestBody;
  if (
    method === undefined &&
    path === undefined &&
    requestHeaders === undefined &&
    requestBody === undefined
  ) {
    return undefined;
  }

  return {
    ...(typeof method === "string" ? { method } : {}),
    ...(typeof path === "string" ? { path } : {}),
    ...(requestHeaders !== undefined ? { headers: requestHeaders } : {}),
    ...(requestBody !== undefined ? { body: requestBody } : {}),
  };
}

function extractProvisioningResponse(cause: unknown): Record<string, unknown> | undefined {
  const err = cause as { status?: number; context?: Record<string, unknown> } | undefined;
  const ctx = (err?.context ?? {}) as Record<string, unknown>;
  const status = typeof err?.status === "number" ? err.status : ctx.status;
  const responseHeaders = ctx.responseHeaders;
  const responseBody = ctx.responseBody;
  if (status === undefined && responseHeaders === undefined && responseBody === undefined) {
    return undefined;
  }

  return {
    ...(typeof status === "number" ? { status } : {}),
    ...(responseHeaders !== undefined ? { headers: responseHeaders } : {}),
    ...(responseBody !== undefined ? { body: responseBody } : {}),
  };
}

function toDiagnosticRequestEvidence(
  request: ProvisioningRequestEvidence | undefined,
): Record<string, unknown> | undefined {
  if (!request) {
    return undefined;
  }
  return {
    method: request.method,
    path: request.path,
    ...(request.query ? { query: request.query } : {}),
    ...(request.headers ? { headers: request.headers } : {}),
    ...(request.body !== undefined ? { body: request.body } : {}),
  };
}

function toDiagnosticResponseEvidence(
  response: ProvisioningResponseEvidence | undefined,
): Record<string, unknown> | undefined {
  if (!response) {
    return undefined;
  }
  return {
    status: response.status,
    ...(response.headers ? { headers: response.headers } : {}),
    body: response.body,
  };
}

function toDiagnosticHttpExchanges(
  requests: readonly ProvisioningRequestEvidence[] | undefined,
  responses: readonly ProvisioningResponseEvidence[] | undefined,
): readonly Record<string, unknown>[] | undefined {
  if (!requests?.length) {
    return undefined;
  }
  return requests.map((request, index) => ({
    request: toDiagnosticRequestEvidence(request),
    ...(responses?.[index] ? { response: toDiagnosticResponseEvidence(responses[index]) } : {}),
  }));
}

const COLD_START_WARNING_WINDOW_MS = 5 * 60 * 60 * 1000;
const CLOUDSHARE_TRAINING_NAME_MAX_LENGTH = 100;

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export class ScheduleExamNotFoundError extends Error {
  constructor() {
    super("Published exam not found.");
    this.name = "ScheduleExamNotFoundError";
  }
}

export class ScheduleOverlapError extends Error {
  constructor(
    readonly context: {
      readonly examId: string;
      readonly conflictingAttemptId: string;
      readonly nextAvailableAt: Date;
    },
  ) {
    super("Another attempt for this Exam is still active or available.");
    this.name = "ScheduleOverlapError";
  }

  get nextAvailableAt(): Date {
    return this.context.nextAvailableAt;
  }
}

export class CloudShareProvisioningError extends Error {
  constructor(
    message: string,
    readonly context: {
      readonly attemptId: string;
      readonly attemptedOperation: ProvisioningOperation;
      readonly trainingId?: string;
      readonly cause: unknown;
    },
  ) {
    super(message);
    this.name = "CloudShareProvisioningError";
  }
}

function toTrainingDeliveryFailure(cause: unknown): {
  readonly operation: ProvisioningOperation;
  readonly cause: unknown;
  readonly trainingId?: string;
} {
  if (cause instanceof TrainingDeliveryOperationError) {
    return {
      operation: cause.operation === "read_training" ? "create_training" : cause.operation,
      cause: cause.context.cause,
      ...(cause.context.trainingId ? { trainingId: cause.context.trainingId } : {}),
    };
  }
  return { operation: "create_training", cause };
}

export interface ScheduleExamDeps {
  readonly exams: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  /** Scheduling crosses one deep Training-delivery operation. */
  readonly trainingDelivery: IndividualTrainingDelivery;
  readonly newId: () => string;
  readonly now: () => Date;
  /** Optional support diagnostics. Callers always wire it; recording never throws. */
  readonly diagnostics?: DiagnosticRecorder;
}

export interface ScheduleExamInput {
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName: string;
  readonly candidateLastName: string;
  readonly examId: string;
  readonly scheduledFor: Date;
  /** Correlation id shared with the caller's audit/event-log thread, if any. */
  readonly correlationId?: string;
}

export interface ScheduledAttemptSummary {
  readonly id: string;
  readonly examId: string;
  readonly scheduledFor: string;
  readonly status: "scheduled" | "ready";
}

export interface ScheduleExamResult {
  readonly attempt: ScheduledAttemptSummary;
  readonly coldStartLikely: boolean;
  readonly trainingId: string;
  readonly experienceId: string;
}

export async function scheduleExam(
  deps: ScheduleExamDeps,
  input: ScheduleExamInput,
): Promise<ScheduleExamResult> {
  validateScheduledFor(input.scheduledFor, deps.now());

  const exam = await deps.exams.findById(input.examId);
  if (
    !exam ||
    exam.customerId !== input.customerId ||
    exam.status !== "published" ||
    !isIndividualExamDeliveryAvailable(exam)
  ) {
    throw new ScheduleExamNotFoundError();
  }

  const attemptId = deps.newId();
  const createdAt = deps.now();
  let attempt;
  try {
    attempt = await reserveCandidateAdmissionAttempt(
      { attempts: deps.attempts },
      {
        attemptId,
        customerId: input.customerId,
        candidateId: input.candidateId,
        examId: exam.id,
        scheduledFor: input.scheduledFor,
        createdAt,
        availabilityWindowMinutes: exam.storageLeaseMinutes ?? exam.openPeriodMinutes,
      },
    );
  } catch (error) {
    if (error instanceof CandidateAdmissionConflictError) {
      throw new ScheduleOverlapError({
        examId: exam.id,
        conflictingAttemptId: error.conflictingAttemptId,
        nextAvailableAt: error.nextAvailableAt,
      });
    }
    throw error;
  }

  // Shared anchors for every diagnostic in this provisioning thread so support
  // can trace the ExamAttempt end to end (and filter by it).
  const anchors = {
    source: "scheduling",
    customerId: input.customerId,
    candidateEmail: input.candidateEmail,
    examId: exam.id,
    examAttemptId: attemptId,
    correlationId: input.correlationId ?? null,
    actor: { type: "candidate", id: input.candidateId, email: input.candidateEmail },
    subject: { type: "exam_attempt", id: attemptId },
  } as const;
  const recordSuccess = (
    operation: string,
    message: string,
    extra?: {
      externalIds?: Record<string, string>;
      request?: Record<string, unknown>;
      response?: Record<string, unknown>;
      details?: Record<string, unknown>;
    },
  ) =>
    deps.diagnostics?.record({ ...anchors, level: "info", operation, outcome: "success", message, ...extra });
  const recordFailure = (op: ProvisioningOperation, cause: unknown, externalIds?: Record<string, string>) => {
    const request = extractProvisioningRequest(cause);
    const response = extractProvisioningResponse(cause);
    return deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: `cloudshare.${op}`,
      outcome: "failure",
      message: `CloudShare ${op.replace(/_/g, " ")} failed`,
      ...(externalIds ? { externalIds } : {}),
      ...(request ? { request } : {}),
      ...(response ? { response } : {}),
      details: { attemptedOperation: op, integrationSurface: PROVISIONING_SURFACE[op], ...describeProvisioningCause(cause) },
    });
  };
  const recordProvisioningFailure = (op: ProvisioningOperation) =>
    deps.diagnostics?.record({
      ...anchors,
      level: "error",
      operation: "exam_attempt.provisioning_failed",
      outcome: "failure",
      message: `ExamAttempt provisioning failed during CloudShare ${op.replace(/_/g, " ")}`,
      details: { failedDuring: op },
    });
  const recordCompletedIndividualSteps = async (
    completed: Partial<Awaited<ReturnType<IndividualTrainingDelivery["provisionIndividual"]>>> | undefined,
  ) => {
    if (completed?.training) {
      const training = completed.training;
      await recordSuccess("cloudshare.create_training", "CloudShare training created", {
        externalIds: { trainingId: training.trainingId },
        ...(toDiagnosticRequestEvidence(training.request)
          ? { request: toDiagnosticRequestEvidence(training.request)! }
          : {}),
        ...(toDiagnosticResponseEvidence(training.response)
          ? { response: toDiagnosticResponseEvidence(training.response)! }
          : {}),
        ...(training.integrationSurface ? { details: { integrationSurface: training.integrationSurface } } : {}),
      });
    }
    if (completed?.userProperties && completed.training) {
      const properties = completed.userProperties;
      const trainingId = completed.training.trainingId;
      await recordSuccess("cloudshare.ensure_user_properties", "CloudShare training user-property keys ensured", {
        externalIds: { trainingId, experienceId: trainingId },
        ...(toDiagnosticRequestEvidence(properties.request)
          ? { request: toDiagnosticRequestEvidence(properties.request)! }
          : {}),
        ...(toDiagnosticResponseEvidence(properties.response)
          ? { response: toDiagnosticResponseEvidence(properties.response)! }
          : {}),
        details: {
          ...(properties.integrationSurface ? { integrationSurface: properties.integrationSurface } : {}),
          ...(toDiagnosticHttpExchanges(properties.requests, properties.responses)
            ? { httpExchanges: toDiagnosticHttpExchanges(properties.requests, properties.responses) }
            : {}),
        },
      });
    }
    if (completed?.participant && completed.training) {
      const participant = completed.participant;
      await recordSuccess("cloudshare.add_participant", "CloudShare participant added", {
        externalIds: { trainingId: completed.training.trainingId },
        ...(toDiagnosticRequestEvidence(participant.request)
          ? { request: toDiagnosticRequestEvidence(participant.request)! }
          : {}),
        response: toDiagnosticResponseEvidence(participant.response)!,
        ...(participant.integrationSurface ? { details: { integrationSurface: participant.integrationSurface } } : {}),
      });
    }
  };

  await recordSuccess("exam_attempt.schedule", "ExamAttempt scheduled", {
    request: { scheduledFor: input.scheduledFor.toISOString() },
  });

  const trainingTitle = buildCloudShareTrainingName({
    blueprintName: exam.blueprintName,
    candidateFirstName: input.candidateFirstName,
    candidateLastName: input.candidateLastName,
    candidateEmail: input.candidateEmail,
    scheduledFor: input.scheduledFor,
    createdAt,
  });

  let provisioned;
  try {
    provisioned = await deps.trainingDelivery.provisionIndividual({
      training: {
        title: trainingTitle,
        scheduledFor: input.scheduledFor,
        endsAt: new Date(input.scheduledFor.getTime() + exam.openPeriodMinutes * 60 * 1000),
        projectId: exam.projectId,
        blueprintId: exam.blueprintId,
        policyId: exam.policyId,
        regionIds: exam.allowedRegions.map((region) => region.id),
        instructorId: exam.instructorId,
        passphrase: `certalis-${attemptId}`,
        timeZoneId: "UTC",
        externalId: attemptId,
      },
      participant: {
        email: input.candidateEmail,
        firstName: input.candidateFirstName.trim(),
        lastName: input.candidateLastName.trim(),
        certalisExamAttemptId: attemptId,
        certalisCandidateId: input.candidateId,
      },
    });
  } catch (cause) {
    const failure = toTrainingDeliveryFailure(cause);
    if (cause instanceof TrainingDeliveryOperationError) {
      await recordCompletedIndividualSteps(cause.context.individual);
    }
    await recordFailure(failure.operation, failure.cause, failure.trainingId ? { trainingId: failure.trainingId } : undefined);
    await recordProvisioningFailure(failure.operation);
    await recoverCandidateAdmissionAttempt({ attempts: deps.attempts }, attemptId);
    throw new CloudShareProvisioningError(
      `CloudShare Training provisioning failed during ${failure.operation.replace(/_/g, " ")}.`,
      {
      attemptId,
        attemptedOperation: failure.operation,
        ...(failure.trainingId ? { trainingId: failure.trainingId } : {}),
        cause: failure.cause,
      },
    );
  }

  const { training, userProperties: ensureUserPropertiesResult, participant: addParticipantResult, sponsoredLink } =
    provisioned;
  const trainingId = training.trainingId;
  const teamId = training.teamId;

  const regionIds = exam.allowedRegions.map((region) => region.id).join(",");
  await recordSuccess("cloudshare.create_training", "CloudShare training created", {
    externalIds: {
      trainingId,
      projectId: exam.projectId,
      blueprintId: exam.blueprintId,
      policyId: exam.policyId,
      instructorId: exam.instructorId,
      ...(teamId ? { teamId } : {}),
      ...(regionIds ? { regionIds } : {}),
    },
    ...(toDiagnosticRequestEvidence(training.request)
      ? { request: toDiagnosticRequestEvidence(training.request)! }
      : {}),
    ...(toDiagnosticResponseEvidence(training.response)
      ? { response: toDiagnosticResponseEvidence(training.response)! }
      : {}),
    ...(training.integrationSurface
      ? { details: { integrationSurface: training.integrationSurface } }
      : {}),
  });

  await recordSuccess("cloudshare.ensure_user_properties", "CloudShare training user-property keys ensured", {
    externalIds: { trainingId, experienceId: trainingId },
    ...(toDiagnosticRequestEvidence(ensureUserPropertiesResult.request)
      ? { request: toDiagnosticRequestEvidence(ensureUserPropertiesResult.request)! }
      : {}),
    ...(toDiagnosticResponseEvidence(ensureUserPropertiesResult.response)
      ? { response: toDiagnosticResponseEvidence(ensureUserPropertiesResult.response)! }
      : {}),
    details: {
      ...(ensureUserPropertiesResult.integrationSurface
        ? { integrationSurface: ensureUserPropertiesResult.integrationSurface }
        : {}),
      ...(toDiagnosticHttpExchanges(
        ensureUserPropertiesResult.requests,
        ensureUserPropertiesResult.responses,
      )
        ? {
            httpExchanges: toDiagnosticHttpExchanges(
              ensureUserPropertiesResult.requests,
              ensureUserPropertiesResult.responses,
            ),
          }
        : {}),
    },
  });

  await recordSuccess("cloudshare.add_participant", "CloudShare participant added", {
    externalIds: { trainingId },
    ...(toDiagnosticRequestEvidence(addParticipantResult.request)
      ? { request: toDiagnosticRequestEvidence(addParticipantResult.request)! }
      : {}),
    response: toDiagnosticResponseEvidence(addParticipantResult.response)!,
    ...(addParticipantResult.integrationSurface
      ? { details: { integrationSurface: addParticipantResult.integrationSurface } }
      : {}),
  });

  await recordSuccess("cloudshare.create_sponsored_link", "CloudShare sponsored link created", {
    externalIds: { trainingId },
    ...(toDiagnosticRequestEvidence(sponsoredLink.request)
      ? { request: toDiagnosticRequestEvidence(sponsoredLink.request)! }
      : {}),
    ...(toDiagnosticResponseEvidence(sponsoredLink.response)
      ? { response: toDiagnosticResponseEvidence(sponsoredLink.response)! }
      : {}),
    ...(sponsoredLink.integrationSurface
      ? { details: { integrationSurface: sponsoredLink.integrationSurface } }
      : {}),
  });

  const completed = await completeCandidateAdmission(
    { attempts: deps.attempts, launches: deps.launches },
    {
      attempt,
      launch: {
    id: deps.newId(),
    candidateId: input.candidateId,
    participantEmail: input.candidateEmail,
    trainingId,
    experienceId: trainingId,
    loginUrl: sponsoredLink.loginUrl,
    status: "launched",
    createdAt: deps.now(),
      },
    },
  );
  const readyAttempt = completed.attempt;

  await recordSuccess("exam_attempt.provisioned", "ExamAttempt provisioned and ready", {
    externalIds: { trainingId, experienceId: trainingId },
    response: { attemptStatus: "ready" },
  });

  return {
    attempt: {
      id: readyAttempt.id,
      examId: readyAttempt.examId,
      scheduledFor: input.scheduledFor.toISOString(),
      status: "ready",
    },
    coldStartLikely: input.scheduledFor.getTime() - deps.now().getTime() < COLD_START_WARNING_WINDOW_MS,
    trainingId,
    experienceId: trainingId,
  };
}

function buildCloudShareTrainingName(input: {
  readonly blueprintName: string;
  readonly candidateFirstName: string;
  readonly candidateLastName: string;
  readonly candidateEmail: string;
  readonly scheduledFor: Date;
  readonly createdAt: Date;
}): string {
  const name = [input.candidateFirstName, input.candidateLastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const suffix = [formatUtcStamp(input.scheduledFor), formatUtcStamp(input.createdAt)].join(" - ");
  const identityMaxLength = CLOUDSHARE_TRAINING_NAME_MAX_LENGTH - suffix.length - " - ".length;
  const identity = fitJoinedNameParts(
    normalizeNamePart(input.blueprintName),
    normalizeNamePart(name),
    normalizeNamePart(input.candidateEmail),
    identityMaxLength,
  );
  return [identity, suffix].join(" - ");
}

function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function fitJoinedNameParts(
  blueprintName: string,
  candidateName: string,
  candidateEmail: string,
  maxLength: number,
): string {
  const parts = [blueprintName, candidateName, candidateEmail];
  const separatorLength = " - ".length * (parts.length - 1);
  const contentMaxLength = maxLength - separatorLength;

  if (parts.join(" - ").length <= maxLength) {
    return parts.join(" - ");
  }

  const budgets = parts.map((part) => part.length);
  while (budgets.reduce((sum, value) => sum + value, 0) > contentMaxLength) {
    const largestIndex = budgets.reduce(
      (largest, value, index) => (value > budgets[largest]! ? index : largest),
      0,
    );
    budgets[largestIndex] = Math.max(1, budgets[largestIndex]! - 1);
  }

  return parts.map((part, index) => truncateNamePart(part, budgets[index]!)).join(" - ");
}

function truncateNamePart(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatUtcStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(".000", "");
}

function validateScheduledFor(scheduledFor: Date, now: Date): void {
  if (!(scheduledFor instanceof Date) || Number.isNaN(scheduledFor.getTime())) {
    throw new ScheduleValidationError("scheduledFor must be a valid datetime.");
  }

  if (scheduledFor.getTime() <= now.getTime()) {
    throw new ScheduleValidationError("scheduledFor must be in the future.");
  }
}

async function findSameExamAvailabilityOverlap(input: {
  readonly attempts: ExamAttemptRepository;
  readonly candidateId: string;
  readonly examId: string;
  readonly scheduledFor: Date;
  readonly availabilityWindowMinutes: number;
}): Promise<{ readonly conflictingAttemptId: string; readonly nextAvailableAt: Date } | null> {
  const requestedAtMs = input.scheduledFor.getTime();
  const windowMs = input.availabilityWindowMinutes * 60 * 1000;
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
