/**
 * `ExamAttempt` is the candidate's specific attempt at a Genesys certification
 * exam — the spine the whole proctoring flow hangs off (lab entitlement, the
 * proctoring session, scoring all reference it). Booking creates one; later
 * slices advance its status.
 */

export type ExamAttemptStatus = "booked";

export interface ExamAttempt {
  readonly id: string;
  readonly candidateId: string;
  readonly examId: string;
  readonly status: ExamAttemptStatus;
  readonly createdAt: Date;
}

/** Persistence port for ExamAttempts. Implemented in the persistence layer. */
export interface ExamAttemptRepository {
  save(attempt: ExamAttempt): Promise<void>;
  findById(id: string): Promise<ExamAttempt | null>;
  listByCandidate(candidateId: string): Promise<ExamAttempt[]>;
}
