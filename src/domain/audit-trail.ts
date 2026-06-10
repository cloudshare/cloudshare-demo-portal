/**
 * Audit trail domain types. An AuditRecord is written for every significant
 * portal action (lab launch, suspend, resume, score retrieval) and every external
 * API failure, giving support teams a per-ExamAttempt timeline without needing
 * access to CloudShare, Genesys, or Kryterion directly.
 */

export type AuditAction =
  | "lab_launched"
  | "lab_launch_failed"
  | "lab_suspended"
  | "lab_suspend_failed"
  | "lab_resumed"
  | "lab_resume_failed"
  | "score_retrieved";

export interface AuditRecord {
  readonly id: string;
  readonly examAttemptId: string;
  readonly candidateId?: string;
  readonly action: AuditAction;
  readonly outcome: "success" | "failure";
  readonly details?: Record<string, unknown>;
  readonly error?: string;
  readonly occurredAt: Date;
}

export interface AuditRepository {
  write(record: AuditRecord): Promise<void>;
  listByExamAttemptId(examAttemptId: string): Promise<AuditRecord[]>;
  /** Returns records newest-first. `limit` caps the result set (default: no limit). */
  listAll(limit?: number): Promise<AuditRecord[]>;
}
