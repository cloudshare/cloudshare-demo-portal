export type ExamAttemptStatus =
  | "booked"
  | "scheduled"
  | "ready"
  | "in_progress"
  | "suspended"
  | "completed"
  | "expired";

export interface ExamAttempt {
  readonly id: string;
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
}
