/**
 * Audit trail domain types. The current AuditRecord model is intentionally
 * ExamAttempt-threaded: every record is keyed by `examAttemptId`, so this
 * surface answers "what happened to this candidate attempt?" for launch,
 * suspend, resume, score retrieval, and related external API failures.
 * Exam catalog lifecycle actions are not yet represented here because they are
 * not anchored to an ExamAttempt; those actions currently rely on typed
 * DiagnosticLogEntry records instead of synthetic attempt-scoped audit rows.
 */

export type AuditAction =
  | "lab_launched"
  | "lab_launch_reused"
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
  listByExamAttemptIds(examAttemptIds: readonly string[]): Promise<AuditRecord[]>;
  /** Returns records newest-first. `limit` caps the result set (default: no limit). */
  listAll(limit?: number): Promise<AuditRecord[]>;
}
