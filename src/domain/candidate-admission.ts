import {
  isDuplicateCohortExamAttemptError,
  isSameExamAttemptAvailabilityConflictError,
  type ExamAttempt,
  type ExamAttemptRepository,
} from "./exam-attempt";
import type {
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "./cloudshare-connection";
import type { LabLaunch, LabLaunchRepository } from "./lab-launch";

export class CandidateAdmissionIdentityError extends Error {
  constructor() {
    super("Candidate first name and last name must each contain at least two characters.");
    this.name = "CandidateAdmissionIdentityError";
  }
}

export class CandidateAdmissionConflictError extends Error {
  constructor(
    readonly input: {
      readonly examId: string;
      readonly conflictingAttemptId: string;
      readonly nextAvailableAt: Date;
    },
  ) {
    super(`Candidate already has an active or available ExamAttempt for Exam ${input.examId}.`);
    this.name = "CandidateAdmissionConflictError";
  }

  get conflictingAttemptId(): string {
    return this.input.conflictingAttemptId;
  }

  get nextAvailableAt(): Date {
    return this.input.nextAvailableAt;
  }
}

export class CandidateAdmissionRetakeError extends Error {
  constructor(readonly cohortSessionId: string) {
    super(`Candidate already has an ExamAttempt for Cohort Exam Session ${cohortSessionId}.`);
    this.name = "CandidateAdmissionRetakeError";
  }
}

export class CandidateAdmissionConnectionError extends Error {
  constructor(readonly customerId: string) {
    super(`CloudShare is not connected for Customer ${customerId}.`);
    this.name = "CandidateAdmissionConnectionError";
  }
}

export interface CandidateAdmissionIdentity {
  readonly firstName: string;
  readonly lastName: string;
}

export function requireCandidateAdmissionIdentity(input: CandidateAdmissionIdentity): CandidateAdmissionIdentity {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (firstName.length < 2 || lastName.length < 2) {
    throw new CandidateAdmissionIdentityError();
  }
  return { firstName, lastName };
}

export async function requireCandidateAdmissionConnection(
  connections: CloudShareConnectionRepository,
  customerId: string,
): Promise<CloudShareConnectionRecord> {
  const connection = await connections.findByCustomerId(customerId);
  if (!connection) {
    throw new CandidateAdmissionConnectionError(customerId);
  }
  return connection;
}

export interface CandidateAdmissionReservationDeps {
  readonly attempts: ExamAttemptRepository;
}

export interface CandidateAdmissionReservationInput {
  readonly attemptId: string;
  readonly customerId: string;
  readonly candidateId: string;
  readonly examId: string;
  readonly cohortSessionId?: string;
  readonly scheduledFor: Date;
  readonly createdAt: Date;
  readonly availabilityWindowMinutes: number;
}

export async function reserveCandidateAdmissionAttempt(
  deps: CandidateAdmissionReservationDeps,
  input: CandidateAdmissionReservationInput,
): Promise<ExamAttempt> {
  const existingAttempts = await deps.attempts.listByCandidate(input.candidateId);
  assertCandidateAdmissionAvailability({
    attempts: existingAttempts,
    examId: input.examId,
    cohortSessionId: input.cohortSessionId,
    scheduledFor: input.scheduledFor,
    availabilityWindowMinutes: input.availabilityWindowMinutes,
  });

  const attempt: ExamAttempt = {
    id: input.attemptId,
    customerId: input.customerId,
    candidateId: input.candidateId,
    examId: input.examId,
    ...(input.cohortSessionId ? { cohortSessionId: input.cohortSessionId } : {}),
    status: "scheduled",
    scheduledFor: input.scheduledFor,
    createdAt: input.createdAt,
  };

  try {
    if (deps.attempts.saveWithSameExamAvailabilityGuard) {
      await deps.attempts.saveWithSameExamAvailabilityGuard(attempt, {
        availabilityWindowMinutes: input.availabilityWindowMinutes,
      });
    } else {
      await deps.attempts.save(attempt);
    }
  } catch (error) {
    if (isDuplicateCohortExamAttemptError(error)) {
      throw new CandidateAdmissionRetakeError(error.cohortSessionId);
    }
    if (isSameExamAttemptAvailabilityConflictError(error)) {
      throw new CandidateAdmissionConflictError({
        examId: error.examId,
        conflictingAttemptId: error.conflictingAttemptId,
        nextAvailableAt: error.nextAvailableAt,
      });
    }
    throw error;
  }

  return attempt;
}

export function assertCandidateAdmissionAvailability(input: {
  readonly attempts: readonly ExamAttempt[];
  readonly examId: string;
  readonly cohortSessionId?: string;
  readonly scheduledFor: Date;
  readonly availabilityWindowMinutes: number;
}): void {
  if (
    input.cohortSessionId &&
    input.attempts.some(
      (attempt) => attempt.examId === input.examId && attempt.cohortSessionId === input.cohortSessionId,
    )
  ) {
    throw new CandidateAdmissionRetakeError(input.cohortSessionId);
  }

  const overlap = findCandidateAdmissionOverlap({
    attempts: input.attempts,
    examId: input.examId,
    scheduledFor: input.scheduledFor,
    availabilityWindowMinutes: input.availabilityWindowMinutes,
  });
  if (overlap) {
    throw new CandidateAdmissionConflictError({ examId: input.examId, ...overlap });
  }
}

export function findCandidateAdmissionOverlap(input: {
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
      return { conflictingAttemptId: attempt.id, nextAvailableAt: new Date(windowEndMs) };
    }
  }

  return null;
}

export interface CandidateAdmissionCompletionDeps {
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
}

export async function completeCandidateAdmission(
  deps: CandidateAdmissionCompletionDeps,
  input: {
    readonly attempt: ExamAttempt;
    readonly launch: Omit<LabLaunch, "examAttemptId">;
  },
): Promise<{ readonly attempt: ExamAttempt; readonly launch: LabLaunch }> {
  const attempt: ExamAttempt = { ...input.attempt, status: "ready" };
  const launch: LabLaunch = { ...input.launch, examAttemptId: attempt.id };
  await deps.attempts.save(attempt);
  await deps.launches.save(launch);
  return { attempt, launch };
}

export async function recoverCandidateAdmissionAttempt(
  deps: Pick<CandidateAdmissionReservationDeps, "attempts">,
  attemptId: string,
): Promise<void> {
  await deps.attempts.delete(attemptId);
}
