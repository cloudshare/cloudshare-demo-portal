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
export const ORDINARY_AUDIT_FAILURE_MESSAGE = "Operation failed; inspect correlated diagnostics.";

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

const SAFE_AUDIT_DETAIL_KEYS = new Set([
  "operation",
  "attemptedOperation",
  "integrationSurface",
  "outcome",
  "failureMode",
  "responseStatus",
  "status",
  "method",
  "path",
  "source",
  "resourceType",
  "deliveryMode",
  "lifecycle",
  "action",
  "scheduledFor",
  "previousStatus",
  "newStatus",
  "changedFields",
  "confirmationRequired",
  "activeParticipantCount",
  "nonTerminalEnvironmentCount",
  "participantCount",
  "sectionCount",
  "capacity",
  "parentExamStatusChanged",
  "failedStage",
  "requiredKeys",
  "availableKeys",
]);
const SAFE_AUDIT_ID_KEY = /^(?:customer|candidate|exam|examAttempt|environment|environmentExternal|training|participant|project|blueprint|policy|region|webhook|cohortExamSession|session|experience|team|opportunity|contact|salesSession|idempotency)Ids?$/;

export function redactAuditDetails(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (!SAFE_AUDIT_DETAIL_KEYS.has(key) && !SAFE_AUDIT_ID_KEY.test(key)) return [];
      const projected = key === "path" ? projectAuditPath(child) : projectAuditMetadataValue(child);
      return projected === undefined ? [] : [[key, projected]];
    }),
  );
}

export function projectAuditError(value: string | null | undefined): string | null {
  return value ? ORDINARY_AUDIT_FAILURE_MESSAGE : null;
}

function projectAuditMetadataValue(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value) && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) return value;
  return undefined;
}

function projectAuditPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.split(/[?#]/, 1)[0];
}

export interface AuditRepository {
  write(record: AuditRecord): Promise<void>;
  listByExamAttemptId(examAttemptId: string): Promise<AuditRecord[]>;
  listByExamAttemptIds(examAttemptIds: readonly string[]): Promise<AuditRecord[]>;
  query(query: AuditQuery): Promise<AuditRecord[]>;
  /** Returns records newest-first. `limit` caps the result set (default: no limit). */
  listAll(limit?: number): Promise<AuditRecord[]>;
}
