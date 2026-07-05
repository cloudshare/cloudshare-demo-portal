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

export function isDuplicateCohortExamAttemptError(
  value: unknown,
): value is DuplicateCohortExamAttemptError {
  return value instanceof DuplicateCohortExamAttemptError;
}

/** Persistence port for ExamAttempts. Implemented in the persistence layer. */
export interface ExamAttemptRepository {
  save(attempt: ExamAttempt): Promise<void>;
  findById(id: string): Promise<ExamAttempt | null>;
  listByCandidate(candidateId: string): Promise<ExamAttempt[]>;
  delete(id: string): Promise<void>;
}
