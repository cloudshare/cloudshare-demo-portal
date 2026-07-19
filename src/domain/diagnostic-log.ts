import type { LogLevel } from "@/observability/logger";

/**
 * DiagnosticLogEntry — the typed, append-only support source of truth (ADR-004).
 *
 * A DiagnosticLogEntry is a generic platform trace with nullable domain anchors.
 * Core correlation fields (customer, actor, subject, operation, outcome,
 * correlation ID, candidate email, exam ID, exam-attempt ID) are first-class so
 * support filtering and tracing never depend on brittle JSON-string search.
 * Free-form data may live in `externalIds`, `request`, `response`, and `details`.
 *
 * Entries are append-only evidence: later discoveries emit new correlated entries
 * rather than mutate existing rows. There is intentionally no update/delete on the
 * repository interface (a dev-only `reset` exists on the concrete implementations).
 */

export type DiagnosticOutcome = "success" | "failure";

/** Who initiated the action. `type` is open-ended for future platform actors. */
export interface DiagnosticActor {
  readonly type: string; // e.g. "candidate", "admin", "system", "anonymous"
  readonly id?: string | null;
  readonly email?: string | null;
}

/** What the action was about. `type` is open-ended for future platform subjects. */
export interface DiagnosticSubject {
  readonly type: string; // e.g. "candidate", "exam", "exam_attempt", "customer"
  readonly id?: string | null;
}

export interface DiagnosticLogEntry {
  readonly id: string;
  readonly occurredAt: Date;
  readonly level: LogLevel;
  readonly source: string;
  readonly operation: string;
  readonly outcome: DiagnosticOutcome;
  readonly customerId: string | null;
  readonly actor: DiagnosticActor | null;
  readonly subject: DiagnosticSubject | null;
  readonly message: string;
  readonly correlationId: string | null;
  readonly candidateEmail: string | null;
  readonly examId: string | null;
  readonly examAttemptId: string | null;
  /** Structured CloudShare / external identifiers, e.g. { environmentId: "..." }. */
  readonly externalIds: Readonly<Record<string, string>> | null;
  readonly request: Readonly<Record<string, unknown>> | null;
  readonly response: Readonly<Record<string, unknown>> | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

/** Caller-supplied entry. `id` is assigned and `occurredAt`/`level` are defaulted. */
export interface DiagnosticLogEntryInput {
  readonly occurredAt?: Date;
  readonly level?: LogLevel;
  readonly source: string;
  readonly operation: string;
  readonly outcome: DiagnosticOutcome;
  readonly customerId?: string | null;
  readonly actor?: DiagnosticActor | null;
  readonly subject?: DiagnosticSubject | null;
  readonly message: string;
  readonly correlationId?: string | null;
  readonly candidateEmail?: string | null;
  readonly examId?: string | null;
  readonly examAttemptId?: string | null;
  readonly externalIds?: Record<string, string> | null;
  readonly request?: Record<string, unknown> | null;
  readonly response?: Record<string, unknown> | null;
  readonly details?: Record<string, unknown> | null;
}

export interface DiagnosticLogQuery {
  /** Exact Customer match — the primary isolation boundary for the read API. */
  readonly customerId?: string;
  /** Exact Exam match for exam lifecycle diagnostics. */
  readonly examId?: string;
  /** Trace one ExamAttempt thread end to end. Matched on the first-class column. */
  readonly examAttemptId?: string;
  /** Case-insensitive exact Candidate email match. */
  readonly candidateEmail?: string;
  /** Exact operation match for support filtering. */
  readonly operation?: string;
  /** Exact outcome match for support filtering. */
  readonly outcome?: DiagnosticOutcome;
  /** Exact source match for support filtering. */
  readonly source?: string;
  /** Exact correlation match for support tracing. */
  readonly correlationId?: string;
  readonly subjectId?: string;
  /**
   * Exact integration surface match, typically emitted in `details.integrationSurface`.
   * Not every row carries it.
   */
  readonly integrationSurface?: string;
  /**
   * Exact CloudShare/external identifier match against structured `externalIds`
   * values, e.g. environmentId/trainingId/participantId.
   */
  readonly externalId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

export interface DiagnosticLogRepository {
  /** Append one entry. Returns the persisted entry with its assigned `id`. */
  append(input: DiagnosticLogEntryInput): Promise<DiagnosticLogEntry>;
  /** Read entries newest-first, filtered on first-class columns and bounded. */
  query(query?: DiagnosticLogQuery): Promise<DiagnosticLogEntry[]>;
}

/** Default and hard-cap read bounds. Reads are always bounded. */
export const DEFAULT_DIAGNOSTIC_QUERY_LIMIT = 100;
export const MAX_DIAGNOSTIC_QUERY_LIMIT = 500;

/** Clamp an optional caller limit into [1, MAX], defaulting when absent/invalid. */
export function boundDiagnosticLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_DIAGNOSTIC_QUERY_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_DIAGNOSTIC_QUERY_LIMIT);
}

export function boundDiagnosticOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset) || offset <= 0) {
    return 0;
  }
  return Math.floor(offset);
}

// --- Redaction -------------------------------------------------------------

const REDACTED = "[REDACTED]";

/**
 * The protected-diagnostic evidence contract is structural, not name-based:
 * request headers are masked, while request/query and provider-response bodies
 * are retained verbatim. This must remain the single redaction seam; callers
 * must not pre-scrub provider evidence based on field names.
 */
function redactRequestHeaders(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => Array.isArray(entry) && entry.length === 2
      ? [entry[0], REDACTED]
      : redactRequestHeaders(entry));
  }
  if (!value || typeof value !== "object") return REDACTED;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((key) => [key, REDACTED]));
}

function projectProtectedRequest(request: Record<string, unknown>): Record<string, unknown> {
  return projectProtectedMetadata(request, true) as Record<string, unknown>;
}

function projectProtectedMetadata(value: unknown, inRequest = false): unknown {
  if (Array.isArray(value)) return value.map((item) => projectProtectedMetadata(item, inRequest));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (/^(?:body|requestBody|query|requestQuery|response|responseBody)$/i.test(key)) return [key, child];
    const nextInRequest = inRequest || /^request$/i.test(key);
    if (/^requestHeaders$/i.test(key) || (nextInRequest && /^headers$/i.test(key))) return [key, redactRequestHeaders(child)];
    return [key, projectProtectedMetadata(child, nextInRequest)];
  }));
}

export interface RedactionOptions {
  /** Retained for source compatibility. Bodies are never scrubbed by this seam. */
  readonly secrets?: string[];
  /** Retained for source compatibility. Request-header masking is never bypassed. */
  readonly sensitiveMode?: boolean;
}

/**
 * Apply the protected-diagnostic evidence contract at the recorder seam. No
 * field-name/value-pattern scrubbing is permitted for request or response body
 * evidence; only request-header values are masked.
 */
export function redactDiagnosticInput(
  input: DiagnosticLogEntryInput,
  options: RedactionOptions = {},
): DiagnosticLogEntryInput {
  return {
    ...input,
    request: input.request ? projectProtectedRequest(input.request) : input.request,
    response: input.response,
    details: input.details ? (projectProtectedMetadata(input.details) as Record<string, unknown>) : input.details,
  };
}

// --- Recorder (emitter seam) ----------------------------------------------

export interface DiagnosticRecorderOptions {
  readonly repository: DiagnosticLogRepository;
  /** Literal secret values to scrub from every recorded entry. */
  readonly secrets?: string[];
  /** See RedactionOptions.sensitiveMode — disabled by default. */
  readonly sensitiveMode?: boolean;
  /** Invoked if persistence fails; recording never throws into the caller. */
  readonly onError?: (error: unknown, input: DiagnosticLogEntryInput) => void;
}

/**
 * The write-path seam every instrumented flow calls. It applies redaction before
 * persistence and never throws — a diagnostics failure must not break the action
 * being traced.
 */
export interface DiagnosticRecorder {
  record(input: DiagnosticLogEntryInput): Promise<void>;
}

export function createDiagnosticRecorder(
  options: DiagnosticRecorderOptions,
): DiagnosticRecorder {
  const secrets = options.secrets ?? [];
  const sensitiveMode = options.sensitiveMode ?? false;

  return {
    async record(input: DiagnosticLogEntryInput): Promise<void> {
      try {
        const redacted = redactDiagnosticInput(input, { secrets, sensitiveMode });
        await options.repository.append(redacted);
      } catch (error) {
        options.onError?.(error, input);
      }
    },
  };
}
