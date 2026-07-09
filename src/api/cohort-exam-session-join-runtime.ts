import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { CohortExamSessionRepository } from "@/domain/cohort-exam-session";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EventLogRepository } from "@/domain/event-log";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import {
  isCohortExamSessionDeliveryAvailable,
  type ExamRepository,
} from "@/domain/exam-catalog";
import {
  isDuplicateCohortExamAttemptError,
  isSameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
} from "@/domain/exam-attempt";
import type { LabLaunch, LabLaunchRepository } from "@/domain/lab-launch";
import {
  CloudShareRateLimitError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareLabProvisioner } from "@/integrations/cloudshare/labs";
import type { Logger } from "@/observability/logger";
import { guardRuntimeBlueprintSnapshot } from "./runtime-blueprint-snapshot-guard";

export interface CohortExamSessionJoinRuntimeDeps {
  readonly exams: ExamRepository;
  readonly sessions: CohortExamSessionRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly audit: Pick<AuditRepository, "write">;
  readonly eventLog: EventLogRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly logger: Logger;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface CohortExamSessionJoinRuntimeRequest {
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName?: string | null;
  readonly candidateLastName?: string | null;
  readonly examId: string;
  readonly cohortSessionId: string;
}

export interface CohortExamSessionJoinRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

type JoinProvisioningOperation =
  | "read_training"
  | "add_participant"
  | "create_sponsored_link";

export async function joinCohortExamSessionRuntime(
  deps: CohortExamSessionJoinRuntimeDeps,
  request: CohortExamSessionJoinRuntimeRequest,
): Promise<CohortExamSessionJoinRuntimeResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const exam = await deps.exams.findById(request.examId);
  const session = await deps.sessions.findById(request.cohortSessionId);

  if (
    !exam ||
    exam.customerId !== request.customerId ||
    exam.status !== "published" ||
    !isCohortExamSessionDeliveryAvailable(exam) ||
    !session ||
    session.customerId !== request.customerId ||
    session.examId !== exam.id ||
    session.status !== "published" ||
    session.admissionStartsAt.getTime() > now.getTime() ||
    (session.admissionEndsAt !== null && session.admissionEndsAt.getTime() <= now.getTime()) ||
    !session.cloudShareTrainingId ||
    !session.cloudShareExperienceId
  ) {
    await recordJoinRejection(deps, {
      request,
      correlationId,
      reason: "available_session_not_found",
      status: 404,
      message: "Available Cohort Exam Session not found.",
      examId: exam?.id ?? request.examId,
      cohortSessionId: session?.id ?? request.cohortSessionId,
      externalIds: {
        ...(session?.cloudShareTrainingId ? { trainingId: session.cloudShareTrainingId } : {}),
        ...(session?.cloudShareExperienceId ? { experienceId: session.cloudShareExperienceId } : {}),
      },
      now,
    });
    return { status: 404, body: { error: "Available Cohort Exam Session not found." } };
  }

  if (
    !request.candidateFirstName?.trim() ||
    !request.candidateLastName?.trim() ||
    request.candidateFirstName.trim().length < 2 ||
    request.candidateLastName.trim().length < 2
  ) {
    await recordJoinRejection(deps, {
      request,
      correlationId,
      reason: "candidate_identity_incomplete",
      status: 409,
      message: "Candidate first name and last name are required before starting an Exam.",
      examId: exam.id,
      cohortSessionId: session.id,
      externalIds: {
        cohortSessionId: session.id,
        trainingId: session.cloudShareTrainingId,
        experienceId: session.cloudShareExperienceId,
      },
      now,
    });
    return {
      status: 409,
      body: {
        error: "Candidate first name and last name are required before starting an Exam.",
      },
    };
  }

  const existingAttempts = await deps.attempts.listByCandidate(request.candidateId);
  if (
    existingAttempts.some(
      (attempt) =>
        attempt.examId === exam.id && attempt.cohortSessionId === session.id,
    )
  ) {
    await recordJoinRejection(deps, {
      request,
      correlationId,
      reason: "cohort_session_retake_blocked",
      status: 409,
      message: "This Cohort Exam Session does not allow another attempt for your account.",
      examId: exam.id,
      cohortSessionId: session.id,
      externalIds: {
        cohortSessionId: session.id,
        trainingId: session.cloudShareTrainingId,
        experienceId: session.cloudShareExperienceId,
      },
      now,
    });
    return {
      status: 409,
      body: {
        error: "This Cohort Exam Session does not allow another attempt for your account.",
        code: "cohort_session_retake_blocked",
      },
    };
  }

  const overlap = findSameExamAvailabilityOverlap({
    attempts: existingAttempts,
    examId: exam.id,
    scheduledFor: now,
    availabilityWindowMinutes: exam.storageLeaseMinutes ?? exam.openPeriodMinutes,
  });
  if (overlap) {
    await recordJoinRejection(deps, {
      request,
      correlationId,
      reason: "exam_attempt_overlap",
      status: 409,
      message: "Another attempt for this Exam is still active or available.",
      examId: exam.id,
      cohortSessionId: session.id,
      externalIds: {
        cohortSessionId: session.id,
        trainingId: session.cloudShareTrainingId,
        experienceId: session.cloudShareExperienceId,
      },
      details: {
        conflictingAttemptId: overlap.conflictingAttemptId,
        nextAvailableAt: overlap.nextAvailableAt.toISOString(),
      },
      now,
    });
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

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    await recordJoinRejection(deps, {
      request,
      correlationId,
      reason: "cloudshare_connection_missing",
      status: 409,
      message: "CloudShare is not connected for this customer.",
      examId: exam.id,
      cohortSessionId: session.id,
      externalIds: {
        cohortSessionId: session.id,
        trainingId: session.cloudShareTrainingId,
        experienceId: session.cloudShareExperienceId,
      },
      now,
    });
    return {
      status: 409,
      body: { error: "CloudShare is not connected for this customer." },
    };
  }

  const attemptId = (deps.newId ?? randomUUID)();
  const createdAt = now;
  const attempt: ExamAttempt = {
    id: attemptId,
    customerId: request.customerId,
    candidateId: request.candidateId,
    examId: exam.id,
    cohortSessionId: session.id,
    status: "scheduled",
    scheduledFor: now,
    createdAt,
  };
  try {
    if (deps.attempts.saveWithSameExamAvailabilityGuard) {
      await deps.attempts.saveWithSameExamAvailabilityGuard(attempt, {
        availabilityWindowMinutes: exam.storageLeaseMinutes ?? exam.openPeriodMinutes,
      });
    } else {
      await deps.attempts.save(attempt);
    }
  } catch (error) {
    if (isDuplicateCohortExamAttemptError(error)) {
      await recordJoinRejection(deps, {
        request,
        correlationId,
        reason: "cohort_session_retake_blocked",
        status: 409,
        message: "This Cohort Exam Session does not allow another attempt for your account.",
        examId: exam.id,
        cohortSessionId: session.id,
        externalIds: {
          cohortSessionId: session.id,
          trainingId: session.cloudShareTrainingId,
          experienceId: session.cloudShareExperienceId,
        },
        now,
      });
      return {
        status: 409,
        body: {
          error: "This Cohort Exam Session does not allow another attempt for your account.",
          code: "cohort_session_retake_blocked",
        },
      };
    }
    if (isSameExamAttemptAvailabilityConflictError(error)) {
      await recordJoinRejection(deps, {
        request,
        correlationId,
        reason: "exam_attempt_overlap",
        status: 409,
        message: "Another attempt for this Exam is still active or available.",
        examId: exam.id,
        cohortSessionId: session.id,
        externalIds: {
          cohortSessionId: session.id,
          trainingId: session.cloudShareTrainingId,
          experienceId: session.cloudShareExperienceId,
        },
        details: {
          conflictingAttemptId: error.conflictingAttemptId,
          nextAvailableAt: error.nextAvailableAt.toISOString(),
        },
        now,
      });
      return {
        status: 409,
        body: {
          error:
            `Another attempt for this Exam is still active or available. ` +
            `You can schedule this Exam again after ${error.nextAvailableAt.toISOString()}.`,
          code: "exam_attempt_overlap",
          nextAvailableAt: error.nextAvailableAt.toISOString(),
        },
      };
    }
    throw error;
  }

  const externalIds = {
    cohortSessionId: session.id,
    trainingId: session.cloudShareTrainingId,
    experienceId: session.cloudShareExperienceId,
  };
  const anchors = {
    source: "candidate-portal",
    customerId: request.customerId,
    candidateEmail: request.candidateEmail,
    examId: exam.id,
    examAttemptId: attemptId,
    correlationId,
    actor: { type: "candidate", id: request.candidateId, email: request.candidateEmail },
    subject: { type: "exam_attempt", id: attemptId },
  } as const;

  const snapshotGuardFailure = await guardRuntimeBlueprintSnapshot(deps, {
    source: "candidate-portal",
    operation: "cohort_exam_session.join",
    correlationId,
    customerId: request.customerId,
    examId: exam.id,
    examAttemptId: attemptId,
    cohortSessionId: session.id,
    candidateId: request.candidateId,
    candidateEmail: request.candidateEmail,
    subject: { type: "exam_attempt", id: attemptId },
    projectId: exam.projectId,
    blueprintId: exam.blueprintId,
    savedSnapshotId: exam.snapshotId,
  });
  if (snapshotGuardFailure) {
    await deps.attempts.delete(attemptId);
    return {
      status: snapshotGuardFailure.status,
      body: {
        error:
          snapshotGuardFailure.status === 429
            ? "This Cohort Exam Session is temporarily unavailable because CloudShare is rate limiting requests. Wait a moment, then try again."
            : snapshotGuardFailure.message,
      },
    };
  }

  const cloudshare = deps.cloudshare.forConnection(connection);
  const labs = createCloudShareLabProvisioner(cloudshare);
  const trainingStartStateReader = labs.getTrainingStartState;
  const participantAdder = labs.addParticipant;
  if (!trainingStartStateReader) {
    throw new Error("LabProvisioner does not support cohort training start-state reads.");
  }
  if (!participantAdder) {
    throw new Error("LabProvisioner does not support cohort participant registration.");
  }

  let trainingStartState;
  try {
    trainingStartState = await trainingStartStateReader({
      trainingId: session.cloudShareTrainingId,
    });
  } catch (cause) {
    await recordProvisioningFailure(deps, {
      anchors,
      attemptId,
      correlationId,
      examId: exam.id,
      candidateId: request.candidateId,
      externalIds,
      attemptedOperation: "read_training",
      cause,
    });
    await deps.attempts.delete(attemptId);
    return {
      status: isRateLimitCause(cause) ? 429 : 502,
      body: {
        error: isRateLimitCause(cause)
          ? "This Cohort Exam Session is temporarily unavailable because CloudShare is rate limiting requests. Wait a moment, then try again."
          : "CloudShare could not confirm this Cohort Exam Session is open yet.",
        correlationId,
      },
    };
  }

  await deps.diagnostics?.record({
    ...anchors,
    level: "info",
    operation: "cloudshare.read_training",
    outcome: "success",
    message: "CloudShare training start state read for shared Cohort Exam Session",
    externalIds,
    ...(trainingStartState.request
      ? {
          request: {
            method: trainingStartState.request.method,
            path: trainingStartState.request.path,
            ...(trainingStartState.request.headers
              ? { headers: trainingStartState.request.headers }
              : {}),
            ...(trainingStartState.request.body !== undefined
              ? { body: trainingStartState.request.body }
              : {}),
          },
        }
      : {}),
    ...(trainingStartState.response
      ? {
          response: {
            status: trainingStartState.response.status,
            ...(trainingStartState.response.headers
              ? { headers: trainingStartState.response.headers }
              : {}),
            body: trainingStartState.response.body,
          },
        }
      : {}),
    details: {
      integrationSurface:
        trainingStartState.integrationSurface ?? "cloudshare.v4.training.get",
      cloudShareStatus: trainingStartState.status,
      cloudShareStartsAt: trainingStartState.startsAt?.toISOString(),
      cloudShareRawStartsAt: trainingStartState.rawStartsAt,
      cloudShareTimeZone: trainingStartState.timeZone,
    },
  });

  if (trainingStartState.startsAt && trainingStartState.startsAt.getTime() > now.getTime()) {
    await recordJoinRejection(deps, {
      request,
      correlationId,
      reason: "cloudshare_training_not_started",
      status: 409,
      message: "This Cohort Exam Session is not open in CloudShare yet.",
      examId: exam.id,
      cohortSessionId: session.id,
      externalIds,
      details: {
        cloudShareStatus: trainingStartState.status,
        cloudShareStartsAt: trainingStartState.startsAt.toISOString(),
        cloudShareRawStartsAt: trainingStartState.rawStartsAt,
        cloudShareTimeZone: trainingStartState.timeZone,
        localAdmissionStartsAt: session.admissionStartsAt.toISOString(),
        localAdmissionEndsAt: session.admissionEndsAt?.toISOString() ?? null,
      },
      now,
    });
    await deps.attempts.delete(attemptId);
    return {
      status: 409,
      body: {
        error: "This Cohort Exam Session is not open in CloudShare yet.",
        code: "cloudshare_training_not_started",
        cloudShareStartsAt: trainingStartState.startsAt.toISOString(),
        correlationId,
      },
    };
  }

  let addParticipantResult;
  try {
    addParticipantResult = await participantAdder({
      trainingId: session.cloudShareTrainingId,
      email: request.candidateEmail,
      firstName: request.candidateFirstName.trim(),
      lastName: request.candidateLastName.trim(),
      certalisExamAttemptId: attemptId,
      certalisCohortSessionId: session.id,
      certalisCandidateId: request.candidateId,
    });
  } catch (cause) {
    await recordProvisioningFailure(deps, {
      anchors,
      attemptId,
      correlationId,
      examId: exam.id,
      candidateId: request.candidateId,
      externalIds,
      attemptedOperation: "add_participant",
      cause,
    });
    await deps.attempts.delete(attemptId);
    return {
      status: isRateLimitCause(cause) ? 429 : 502,
      body: {
        error: isRateLimitCause(cause)
          ? "This Cohort Exam Session is temporarily unavailable because CloudShare is rate limiting requests. Wait a moment, then try again."
          : "CloudShare provisioning failed for the shared cohort Exam Session.",
        correlationId,
      },
    };
  }

  const participantExternalIds = addParticipantResult.participantId
    ? { ...externalIds, participantId: addParticipantResult.participantId }
    : externalIds;

  await deps.diagnostics?.record({
    ...anchors,
    level: "info",
    operation: "cloudshare.add_participant",
    outcome: "success",
    message: "CloudShare participant added to shared Cohort Exam Session",
    externalIds: participantExternalIds,
    ...(addParticipantResult.request
      ? {
          request: {
            method: addParticipantResult.request.method,
            path: addParticipantResult.request.path,
            ...(addParticipantResult.request.headers
              ? { headers: addParticipantResult.request.headers }
              : {}),
            ...(addParticipantResult.request.body !== undefined
              ? { body: addParticipantResult.request.body }
              : {}),
          },
        }
      : {}),
    response: {
      status: addParticipantResult.response.status,
      ...(addParticipantResult.response.headers
        ? { headers: addParticipantResult.response.headers }
        : {}),
      body: addParticipantResult.response.body,
    },
    details: addParticipantResult.integrationSurface
      ? { integrationSurface: addParticipantResult.integrationSurface }
      : undefined,
  });

  let sponsoredLink;
  try {
    sponsoredLink = await labs.createSponsoredLink({
      trainingId: session.cloudShareTrainingId,
      email: request.candidateEmail,
      firstName: request.candidateFirstName.trim(),
      lastName: request.candidateLastName.trim(),
    });
  } catch (cause) {
    await recordProvisioningFailure(deps, {
      anchors,
      attemptId,
      correlationId,
      examId: exam.id,
      candidateId: request.candidateId,
      externalIds,
      attemptedOperation: "create_sponsored_link",
      cause,
    });
    await deps.attempts.delete(attemptId);
    return {
      status: isRateLimitCause(cause) ? 429 : 502,
      body: {
        error: isRateLimitCause(cause)
          ? "This Cohort Exam Session is temporarily unavailable because CloudShare is rate limiting requests. Wait a moment, then try again."
          : "CloudShare provisioning failed for the shared cohort Exam Session.",
        correlationId,
      },
    };
  }

  await deps.diagnostics?.record({
    ...anchors,
    level: "info",
    operation: "cloudshare.create_sponsored_link",
    outcome: "success",
    message: "CloudShare sponsored link created for shared Cohort Exam Session",
    externalIds: participantExternalIds,
    ...(sponsoredLink.request
      ? {
          request: {
            method: sponsoredLink.request.method,
            path: sponsoredLink.request.path,
            ...(sponsoredLink.request.headers ? { headers: sponsoredLink.request.headers } : {}),
            ...(sponsoredLink.request.body !== undefined ? { body: sponsoredLink.request.body } : {}),
          },
        }
      : {}),
    ...(sponsoredLink.response
      ? {
          response: {
            status: sponsoredLink.response.status,
            ...(sponsoredLink.response.headers ? { headers: sponsoredLink.response.headers } : {}),
            body: sponsoredLink.response.body,
          },
        }
      : {}),
    details: sponsoredLink.integrationSurface
      ? { integrationSurface: sponsoredLink.integrationSurface }
      : undefined,
  });

  const readyAttempt: ExamAttempt = { ...attempt, status: "ready" };
  const launch: LabLaunch = {
    id: (deps.newId ?? randomUUID)(),
    examAttemptId: attempt.id,
    candidateId: request.candidateId,
    participantEmail: request.candidateEmail,
    ...(addParticipantResult.participantId
      ? { participantId: addParticipantResult.participantId }
      : {}),
    trainingId: session.cloudShareTrainingId,
    experienceId: session.cloudShareExperienceId,
    loginUrl: sponsoredLink.loginUrl,
    status: "launched",
    createdAt: now,
  };
  await deps.attempts.save(readyAttempt);
  await deps.launches.save(launch);

  await deps.audit.write({
    id: `${attemptId}:cohort_exam_session_joined:${correlationId}`,
    customerId: request.customerId,
    actorType: "candidate",
    actorId: request.candidateId,
    subjectType: "exam_attempt",
    subjectId: attemptId,
    examAttemptId: attemptId,
    candidateId: request.candidateId,
    examId: exam.id,
    correlationId,
    action: "cohort_exam_session_joined",
    outcome: "success",
    details: externalIds,
    occurredAt: now,
  });
  await deps.diagnostics?.record({
    ...anchors,
    level: "info",
    operation: "cohort_exam_session.join",
    outcome: "success",
    message: "Candidate joined Cohort Exam Session",
    externalIds: participantExternalIds,
    request: { scheduledFor: now.toISOString() },
    response: { attemptStatus: "ready" },
  });
  deps.logger.info("candidate cohort exam joined", {
    correlationId,
    customerId: request.customerId,
    candidateId: request.candidateId,
    examId: exam.id,
    examAttemptId: attemptId,
    cohortSessionId: session.id,
    trainingId: session.cloudShareTrainingId,
    experienceId: session.cloudShareExperienceId,
  });

  return {
    status: 201,
    body: {
      attempt: {
        id: readyAttempt.id,
        examId: readyAttempt.examId,
        cohortSessionId: readyAttempt.cohortSessionId,
        scheduledFor: readyAttempt.scheduledFor?.toISOString() ?? now.toISOString(),
        status: "ready",
      },
      correlationId,
    },
  };
}

function findSameExamAvailabilityOverlap(input: {
  readonly attempts: readonly ExamAttempt[];
  readonly examId: string;
  readonly scheduledFor: Date;
  readonly availabilityWindowMinutes: number;
}): { readonly conflictingAttemptId: string; readonly nextAvailableAt: Date } | null {
  const requestedAtMs = input.scheduledFor.getTime();
  const windowMs = input.availabilityWindowMinutes * 60_000;
  const requestedEndMs = requestedAtMs + windowMs;

  for (const attempt of input.attempts) {
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

async function recordJoinRejection(
  deps: CohortExamSessionJoinRuntimeDeps,
  input: {
    readonly request: CohortExamSessionJoinRuntimeRequest;
    readonly correlationId: string;
    readonly reason: string;
    readonly status: number;
    readonly message: string;
    readonly examId: string;
    readonly cohortSessionId: string;
    readonly externalIds?: Record<string, string>;
    readonly details?: Record<string, unknown>;
    readonly now: Date;
  },
): Promise<void> {
  const externalIds = {
    cohortSessionId: input.cohortSessionId,
    ...(input.externalIds ?? {}),
  };
  await deps.diagnostics?.record({
    source: "candidate-portal",
    customerId: input.request.customerId,
    candidateEmail: input.request.candidateEmail,
    examId: input.examId,
    correlationId: input.correlationId,
    actor: {
      type: "candidate",
      id: input.request.candidateId,
      email: input.request.candidateEmail,
    },
    subject: { type: "cohort_exam_session", id: input.cohortSessionId },
    level: "warn",
    operation: "cohort_exam_session.join",
    outcome: "failure",
    message: input.message,
    externalIds,
    request: {
      examId: input.request.examId,
      cohortSessionId: input.request.cohortSessionId,
      attemptedAt: input.now.toISOString(),
    },
    response: { status: input.status },
    details: {
      reason: input.reason,
      ...(input.details ?? {}),
    },
  });
}

async function recordProvisioningFailure(
  deps: CohortExamSessionJoinRuntimeDeps,
  input: {
    readonly anchors: {
      readonly source: string;
      readonly customerId: string;
      readonly candidateEmail: string;
      readonly examId: string;
      readonly examAttemptId: string;
      readonly correlationId: string;
      readonly actor: { readonly type: string; readonly id: string; readonly email: string };
      readonly subject: { readonly type: string; readonly id: string };
    };
    readonly attemptId: string;
    readonly correlationId: string;
    readonly examId: string;
    readonly candidateId: string;
    readonly externalIds: Record<string, string>;
    readonly attemptedOperation: JoinProvisioningOperation;
    readonly cause: unknown;
  },
): Promise<void> {
  const diagnostic = toProvisioningDiagnostic(input.attemptedOperation, input.cause);
  await deps.diagnostics?.record({
    ...input.anchors,
    level: "warn",
    operation: `cloudshare.${input.attemptedOperation}`,
    outcome: "failure",
    message: `CloudShare ${input.attemptedOperation.replaceAll("_", " ")} failed`,
    externalIds: input.externalIds,
    ...(diagnostic.request ? { request: diagnostic.request } : {}),
    ...(diagnostic.response ? { response: diagnostic.response } : {}),
    details: diagnostic.details,
  });
  await deps.eventLog.append({
    eventId: input.correlationId,
    type: "cloudshare.cohort_exam_session_join.failed",
    occurredAt: deps.now?.() ?? new Date(),
    payload: {
      correlationId: input.correlationId,
      customerId: input.anchors.customerId,
      candidateId: input.candidateId,
      examId: input.examId,
      examAttemptId: input.attemptId,
      ...input.externalIds,
      attemptedOperation: input.attemptedOperation,
      ...toProvisioningLogFields(diagnostic),
    },
  });
  await deps.audit.write({
    id: `${input.attemptId}:cohort_exam_session_join_failed:${input.correlationId}`,
    customerId: input.anchors.customerId,
    actorType: "candidate",
    actorId: input.candidateId,
    subjectType: "exam_attempt",
    subjectId: input.attemptId,
    examAttemptId: input.attemptId,
    candidateId: input.candidateId,
    examId: input.examId,
    correlationId: input.correlationId,
    action: "cohort_exam_session_join_failed",
    outcome: "failure",
    details: {
      ...input.externalIds,
      attemptedOperation: input.attemptedOperation,
      ...toProvisioningLogFields(diagnostic),
    },
    error: "CloudShare provisioning failed for the shared cohort Exam Session.",
    occurredAt: deps.now?.() ?? new Date(),
  });
  deps.logger.warn("candidate cohort exam join failed", {
    correlationId: input.correlationId,
    customerId: input.anchors.customerId,
    candidateId: input.candidateId,
    examId: input.examId,
    examAttemptId: input.attemptId,
    ...input.externalIds,
    attemptedOperation: input.attemptedOperation,
    ...toProvisioningLogFields(diagnostic),
  });
}

function toProvisioningDiagnostic(
  attemptedOperation: JoinProvisioningOperation,
  cause: unknown,
): {
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
  readonly details: Record<string, unknown>;
} {
  const context = (cause as { context?: Record<string, unknown> }).context ?? {};
  const status =
    typeof (cause as { status?: unknown }).status === "number"
      ? ((cause as { status: number }).status)
      : undefined;
  const request =
    context.method || context.path || context.requestHeaders || context.requestBody
      ? {
          method: context.method ?? (attemptedOperation === "read_training" ? "GET" : "POST"),
          path: context.path ?? fallbackProvisioningPath(attemptedOperation),
          ...(context.requestHeaders ? { headers: context.requestHeaders } : {}),
          ...(context.requestBody !== undefined ? { body: context.requestBody } : {}),
        }
      : undefined;
  const response =
    status !== undefined || context.responseHeaders || context.responseBody
      ? {
          ...(status !== undefined ? { status } : {}),
          ...(context.responseHeaders ? { headers: context.responseHeaders } : {}),
          ...(context.responseBody !== undefined ? { body: context.responseBody } : {}),
        }
      : undefined;

  return {
    request,
    response,
      details: {
        attemptedOperation,
        integrationSurface:
          context.integrationSurface ?? fallbackIntegrationSurface(attemptedOperation),
        failureMode: inferFailureMode(cause),
        ...(status !== undefined ? { responseStatus: status } : {}),
        ...(context.issues ? { issues: context.issues } : {}),
        ...(context.cause ? { cause: context.cause } : {}),
    },
  };
}

function fallbackProvisioningPath(attemptedOperation: JoinProvisioningOperation): string {
  if (attemptedOperation === "read_training") {
    return "/v4/trainings/{trainingId}";
  }
  if (attemptedOperation === "add_participant") {
    return "/v4/trainings/{trainingId}/students";
  }
  return "/v4/trainings/{trainingId}/sponsored-link";
}

function fallbackIntegrationSurface(attemptedOperation: JoinProvisioningOperation): string {
  if (attemptedOperation === "read_training") {
    return "cloudshare.v4.training.get";
  }
  if (attemptedOperation === "add_participant") {
    return "cloudshare.v4.training.participant";
  }
  return "cloudshare.v4.training.sponsored_link";
}

function toProvisioningLogFields(diagnostic: {
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
  readonly details: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    integrationSurface: diagnostic.details.integrationSurface,
    failureMode: diagnostic.details.failureMode,
    responseStatus: diagnostic.details.responseStatus,
    method: diagnostic.request?.method,
    path: diagnostic.request?.path,
    requestBody: diagnostic.request?.body,
    responseBody: diagnostic.response?.body,
  };
}

function inferFailureMode(cause: unknown): string {
  if (cause instanceof CloudShareRateLimitError) {
    return "rate_limit";
  }
  if (cause instanceof CloudShareRequestError) {
    return "http_status";
  }
  if (cause instanceof CloudShareTransportError) {
    return "transport";
  }
  if (cause instanceof CloudShareResponseError) {
    return "unexpected_response";
  }
  return "unknown";
}

function isRateLimitCause(cause: unknown): cause is CloudShareRateLimitError {
  return (
    cause instanceof CloudShareRateLimitError ||
    (typeof cause === "object" &&
      cause !== null &&
      (cause as { name?: unknown }).name === "CloudShareRateLimitError")
  );
}
