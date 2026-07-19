/**
 * Audit trail domain types. Audit answers "who changed what, when, and was it
 * allowed?" It is deliberately separate from DiagnosticLogEntry, which carries
 * support trace evidence and external request/response detail.
 */

export type AuditAction =
  | "lab_launched"
  | "lab_launch_reused"
  | "lab_launch_failed"
  | "lab_suspended"
  | "lab_suspend_failed"
  | "lab_resumed"
  | "lab_resume_failed"
  | "exam_completed_early"
  | "score_retrieved"
  | string;

export const REDACTED_AUDIT_VALUE = "[REDACTED]";

export interface AuditRecord {
  readonly id: string;
  readonly customerId?: string | null;
  readonly actorType?: string | null;
  readonly actorId?: string | null;
  readonly actorEmail?: string | null;
  readonly action: AuditAction;
  readonly subjectType?: string | null;
  readonly subjectId?: string | null;
  readonly outcome: "success" | "failure" | "denied";
  readonly candidateId?: string | null;
  readonly candidateEmail?: string | null;
  readonly examId?: string | null;
  readonly examAttemptId?: string | null;
  readonly correlationId?: string | null;
  readonly details?: Record<string, unknown> | null;
  readonly error?: string | null;
  readonly occurredAt: Date;
}

export interface AuditQuery {
  readonly customerId?: string;
  readonly actorEmail?: string;
  readonly action?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly outcome?: AuditRecord["outcome"];
  readonly candidateEmail?: string;
  readonly examId?: string;
  readonly examAttemptId?: string;
  readonly correlationId?: string;
  readonly limit?: number;
}

const SECRET_KEY_PATTERN = /(api[-_]?key|api[-_]?id|secret|token|password|authorization|bearer|hmac|login[-_]?url|signature)/i;
const PROTECTED_CONTEXT_KEY_PATTERN = /^(?:request|response)?(?:body|headers)$|^(?:rawBody|query|queryParameters|payload|context|cause)$/i;

export function redactAuditDetails(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return redactAuditValue(value) as Record<string, unknown>;
}

function redactAuditValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return REDACTED_AUDIT_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([childKey]) => !PROTECTED_CONTEXT_KEY_PATTERN.test(childKey))
        .map(([childKey, childValue]) => [
          childKey,
          redactAuditValue(childValue, childKey),
        ]),
    );
  }
  return value;
}

export interface AuditRepository {
  write(record: AuditRecord): Promise<void>;
  listByExamAttemptId(examAttemptId: string): Promise<AuditRecord[]>;
  listByExamAttemptIds(examAttemptIds: readonly string[]): Promise<AuditRecord[]>;
  query(query: AuditQuery): Promise<AuditRecord[]>;
  /** Returns records newest-first. `limit` caps the result set (default: no limit). */
  listAll(limit?: number): Promise<AuditRecord[]>;
}
