export type LegacyExamAttemptStatus = "booked";

export type ActiveExamAttemptStatus =
  | "scheduled"
  | "ready"
  | "in_progress"
  | "suspended"
  | "completed"
  | "expired";

export type ExamAttemptStatus = LegacyExamAttemptStatus | ActiveExamAttemptStatus;

export interface ExamAttempt {
  readonly id: string;
  readonly customerId?: string;
  readonly candidateId: string;
  readonly examId: string;
  readonly cohortSessionId?: string;
  readonly status: ExamAttemptStatus;
  readonly scheduledFor?: Date;
  readonly createdAt: Date;
}

export class DuplicateCohortExamAttemptError extends Error {
  constructor(
    readonly candidateId: string,
    readonly cohortSessionId: string,
  ) {
    super(`Candidate ${candidateId} already has an ExamAttempt for Cohort Exam Session ${cohortSessionId}`);
    this.name = "DuplicateCohortExamAttemptError";
  }
}

export class SameExamAttemptAvailabilityConflictError extends Error {
  constructor(
    readonly candidateId: string,
    readonly examId: string,
    readonly conflictingAttemptId: string,
    readonly nextAvailableAt: Date,
  ) {
    super(
      `Candidate ${candidateId} already has an overlapping active ExamAttempt ${conflictingAttemptId} for Exam ${examId}`,
    );
    this.name = "SameExamAttemptAvailabilityConflictError";
  }
}

export function isDuplicateCohortExamAttemptError(
  value: unknown,
): value is DuplicateCohortExamAttemptError {
  return value instanceof DuplicateCohortExamAttemptError;
}

export function isSameExamAttemptAvailabilityConflictError(
  value: unknown,
): value is SameExamAttemptAvailabilityConflictError {
  return value instanceof SameExamAttemptAvailabilityConflictError;
}

export interface ExamAttemptRuntimeCommand {
  readonly customerId: string;
  readonly examAttemptId: string;
  readonly commandId: string;
  readonly action: "suspend" | "resume";
  readonly environmentId: string;
}

export interface PendingExamAttemptRuntimeCommand extends ExamAttemptRuntimeCommand {
  /** Only the owner can finish dispatching; observers may settle only observing. */
  readonly phase: "dispatching" | "observing";
}

/** Persistence port for ExamAttempts. Implemented in the persistence layer. */
export interface ExamAttemptRepository {
  /** Runtime callers fail closed when an older adapter lacks these atomic operations. */
  readRuntimeCommand?(customerId: string, examAttemptId: string): Promise<PendingExamAttemptRuntimeCommand | null>;
  claimRuntimeCommand?(command: ExamAttemptRuntimeCommand, expectedStatus: "in_progress" | "suspended"): Promise<boolean>;
  finishRuntimeCommandDispatch?(command: ExamAttemptRuntimeCommand): Promise<boolean>;
  settleRuntimeCommand?(command: ExamAttemptRuntimeCommand, at: Date): Promise<boolean>;
  releaseRuntimeCommand?(command: ExamAttemptRuntimeCommand): Promise<void>;
  save(attempt: ExamAttempt): Promise<void>;
  saveWithSameExamAvailabilityGuard?(
    attempt: ExamAttempt,
    options: { readonly availabilityWindowMinutes: number },
  ): Promise<void>;
  findById(id: string): Promise<ExamAttempt | null>;
  listByCandidate(candidateId: string): Promise<ExamAttempt[]>;
  delete(id: string): Promise<void>;
}
