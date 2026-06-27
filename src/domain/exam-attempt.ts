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
  readonly status: ExamAttemptStatus;
  readonly scheduledFor?: Date;
  readonly createdAt: Date;
}

/** Persistence port for ExamAttempts. Implemented in the persistence layer. */
export interface ExamAttemptRepository {
  save(attempt: ExamAttempt): Promise<void>;
  findById(id: string): Promise<ExamAttempt | null>;
  listByCandidate(candidateId: string): Promise<ExamAttempt[]>;
  delete(id: string): Promise<void>;
}
