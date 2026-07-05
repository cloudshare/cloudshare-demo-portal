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

/** Persistence port for ExamAttempts. Implemented in the persistence layer. */
export interface ExamAttemptRepository {
  save(attempt: ExamAttempt): Promise<void>;
  saveWithSameExamAvailabilityGuard?(
    attempt: ExamAttempt,
    options: { readonly availabilityWindowMinutes: number },
  ): Promise<void>;
  findById(id: string): Promise<ExamAttempt | null>;
  listByCandidate(candidateId: string): Promise<ExamAttempt[]>;
  delete(id: string): Promise<void>;
}
