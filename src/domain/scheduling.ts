import type { ExamRepository } from "./exam-catalog";
import type { ExamAttempt, ExamAttemptRepository } from "./exam-attempt";
import type {
  LabLaunch,
  LabLaunchRepository,
  LabProvisioner,
  ProvisioningRequestEvidence,
  ProvisioningResponseEvidence,
} from "./lab-launch";
import type { DiagnosticRecorder } from "./diagnostic-log";

type ProvisioningOperation = "create_training" | "add_participant" | "create_sponsored_link";

const PROVISIONING_SURFACE: Record<ProvisioningOperation, string> = {
  create_training: "cloudshare.v4.training",
  add_participant: "cloudshare.v4.training.participant",
  create_sponsored_link: "cloudshare.v4.training.sponsored_link",
};

/**
 * Structural (non-CloudShare-coupled) summary of a provisioning failure cause.
 * Reads only plain error properties so the domain stays free of integration
 * imports. The CloudShare adapter already redacts headers/body before placing
 * them in `context`, and the DiagnosticRecorder redacts again on the way out.
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

export class CloudShareProvisioningError extends Error {
  constructor(
    message: string,
    readonly context: {
      readonly attemptId: string;
      readonly attemptedOperation: "create_training" | "add_participant" | "create_sponsored_link";
      readonly trainingId?: string;
      readonly cause: unknown;
    },
  ) {
    super(message);
    this.name = "CloudShareProvisioningError";
  }
}

export interface ScheduleExamDeps {
  readonly exams: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly labs: LabProvisioner;
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
  if (!exam || exam.customerId !== input.customerId || exam.status !== "published") {
    throw new ScheduleExamNotFoundError();
  }

  const attemptId = deps.newId();
  const createdAt = deps.now();
  const attempt: ExamAttempt = {
    id: attemptId,
    customerId: input.customerId,
    candidateId: input.candidateId,
    examId: exam.id,
    status: "scheduled",
    scheduledFor: input.scheduledFor,
    createdAt,
  };
  await deps.attempts.save(attempt);

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

  await recordSuccess("exam_attempt.schedule", "ExamAttempt scheduled", {
    request: { scheduledFor: input.scheduledFor.toISOString() },
  });

  const trainingCreator = deps.labs.createTraining;
  const participantAdder = deps.labs.addParticipant;
  if (!trainingCreator || !participantAdder) {
    throw new Error("LabProvisioner does not support training scheduling.");
  }

  const trainingTitle = buildCloudShareTrainingName({
    blueprintName: exam.blueprintName,
    candidateFirstName: input.candidateFirstName,
    candidateLastName: input.candidateLastName,
    candidateEmail: input.candidateEmail,
    scheduledFor: input.scheduledFor,
    createdAt,
  });

  let trainingId: string;
  let teamId: string | undefined;
  let createTrainingIntegrationSurface: string | undefined;
  let createTrainingRequest: ProvisioningRequestEvidence | undefined;
  let createTrainingResponse: ProvisioningResponseEvidence | undefined;
  try {
    const training = await trainingCreator({
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
    });
    trainingId = training.trainingId;
    teamId = training.teamId;
    createTrainingIntegrationSurface = training.integrationSurface;
    createTrainingRequest = training.request;
    createTrainingResponse = training.response;
  } catch (cause) {
    await recordFailure("create_training", cause);
    await deps.attempts.save({ ...attempt, status: "expired" });
    await deps.diagnostics?.record({
      ...anchors,
      level: "error",
      operation: "exam_attempt.expired",
      outcome: "failure",
      message: `ExamAttempt expired: CloudShare create training failed`,
      details: { expiredDueTo: "create_training" },
    });
    throw new CloudShareProvisioningError("CloudShare training creation failed.", {
      attemptId,
      attemptedOperation: "create_training",
      cause,
    });
  }

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
    ...(toDiagnosticRequestEvidence(createTrainingRequest)
      ? { request: toDiagnosticRequestEvidence(createTrainingRequest)! }
      : {}),
    ...(toDiagnosticResponseEvidence(createTrainingResponse)
      ? { response: toDiagnosticResponseEvidence(createTrainingResponse)! }
      : {}),
    ...(createTrainingIntegrationSurface
      ? { details: { integrationSurface: createTrainingIntegrationSurface } }
      : {}),
  });

  const participant = {
    firstName: input.candidateFirstName.trim(),
    lastName: input.candidateLastName.trim(),
  };
  let addParticipantResult;
  try {
    addParticipantResult = await participantAdder({
      trainingId,
      email: input.candidateEmail,
      firstName: participant.firstName,
      lastName: participant.lastName,
    });
  } catch (cause) {
    await recordFailure("add_participant", cause, { trainingId });
    await deps.attempts.save({ ...attempt, status: "expired" });
    await deps.diagnostics?.record({
      ...anchors,
      level: "error",
      operation: "exam_attempt.expired",
      outcome: "failure",
      message: `ExamAttempt expired: CloudShare add participant failed`,
      details: { expiredDueTo: "add_participant" },
    });
    throw new CloudShareProvisioningError("CloudShare participant registration failed.", {
      attemptId,
      attemptedOperation: "add_participant",
      trainingId,
      cause,
    });
  }

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

  let loginUrl: string;
  let createSponsoredLinkIntegrationSurface: string | undefined;
  let createSponsoredLinkRequest: ProvisioningRequestEvidence | undefined;
  let createSponsoredLinkResponse: ProvisioningResponseEvidence | undefined;
  try {
    const sponsoredLink = await deps.labs.createSponsoredLink({
      trainingId,
      email: input.candidateEmail,
      firstName: participant.firstName,
      lastName: participant.lastName,
    });
    loginUrl = sponsoredLink.loginUrl;
    createSponsoredLinkIntegrationSurface = sponsoredLink.integrationSurface;
    createSponsoredLinkRequest = sponsoredLink.request;
    createSponsoredLinkResponse = sponsoredLink.response;
  } catch (cause) {
    await recordFailure("create_sponsored_link", cause, { trainingId });
    await deps.attempts.save({ ...attempt, status: "expired" });
    await deps.diagnostics?.record({
      ...anchors,
      level: "error",
      operation: "exam_attempt.expired",
      outcome: "failure",
      message: `ExamAttempt expired: CloudShare create sponsored link failed`,
      details: { expiredDueTo: "create_sponsored_link" },
    });
    throw new CloudShareProvisioningError("CloudShare sponsored-link creation failed.", {
      attemptId,
      attemptedOperation: "create_sponsored_link",
      trainingId,
      cause,
    });
  }

  await recordSuccess("cloudshare.create_sponsored_link", "CloudShare sponsored link created", {
    externalIds: { trainingId },
    ...(toDiagnosticRequestEvidence(createSponsoredLinkRequest)
      ? { request: toDiagnosticRequestEvidence(createSponsoredLinkRequest)! }
      : {}),
    ...(toDiagnosticResponseEvidence(createSponsoredLinkResponse)
      ? { response: toDiagnosticResponseEvidence(createSponsoredLinkResponse)! }
      : {}),
    ...(createSponsoredLinkIntegrationSurface
      ? { details: { integrationSurface: createSponsoredLinkIntegrationSurface } }
      : {}),
  });

  const readyAttempt: ExamAttempt = { ...attempt, status: "ready" };
  const launch: LabLaunch = {
    id: deps.newId(),
    examAttemptId: attempt.id,
    candidateId: input.candidateId,
    participantEmail: input.candidateEmail,
    trainingId,
    experienceId: trainingId,
    loginUrl,
    status: "launched",
    createdAt: deps.now(),
  };
  await deps.attempts.save(readyAttempt);
  await deps.launches.save(launch);

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
