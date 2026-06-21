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
  /** Trace one ExamAttempt thread end to end. Matched on the first-class column. */
  readonly examAttemptId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
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

// --- Redaction -------------------------------------------------------------

const REDACTED = "[REDACTED]";

/**
 * Field names whose values are always scrubbed in normal mode. Matched
 * case-insensitively as a substring so `apiKey`, `webhookSecret`,
 * `authorization`, `loginUrl`, etc. are all covered.
 */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "bearer",
  "hmac",
  "ciphertext",
];

const NON_SENSITIVE_KEYS = new Set(["idempotencyKey", "storedWebhookSecretLength"]);

function isSensitiveKey(key: string): boolean {
  if (NON_SENSITIVE_KEYS.has(key)) {
    return false;
  }
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => k.includes(pattern));
}

function scrubSecretsFromString(value: string, secrets: string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    return scrubSecretsFromString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, secrets);
  }
  return value;
}

function redactRecord(
  record: Record<string, unknown>,
  secrets: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, secrets);
  }
  return out;
}

export interface RedactionOptions {
  /** Literal secret values (API keys, tokens, login URLs) to scrub from strings. */
  readonly secrets?: string[];
  /**
   * Sensitive diagnostic capture. MUST stay disabled in normal operation. When
   * false (the default), all sensitive keys and known secret values are scrubbed
   * before persistence, so secrets can never leak via normal logging. Enabling it
   * is a deliberate, audited, time-boxed follow-up (see ADR-004) and there is
   * intentionally no production path that sets this to true in this slice.
   */
  readonly sensitiveMode?: boolean;
}

/**
 * Redact an entry's free-form structures and scrub secret values from its
 * message. In normal mode (sensitiveMode !== true) sensitive keys are replaced
 * with [REDACTED]. First-class anchor fields (customer, candidate email, exam
 * IDs, correlation ID) are deliberately preserved — they are identifiers, not
 * credentials.
 */
export function redactDiagnosticInput(
  input: DiagnosticLogEntryInput,
  options: RedactionOptions = {},
): DiagnosticLogEntryInput {
  const secrets = (options.secrets ?? []).filter((s) => s.length > 0);
  if (options.sensitiveMode === true) {
    // Sensitive mode bypasses key-based redaction but is never enabled here.
    return input;
  }

  return {
    ...input,
    message: scrubSecretsFromString(input.message, secrets),
    externalIds: input.externalIds
      ? (redactRecord(input.externalIds, secrets) as Record<string, string>)
      : input.externalIds,
    request: input.request ? redactRecord(input.request, secrets) : input.request,
    response: input.response ? redactRecord(input.response, secrets) : input.response,
    details: input.details ? redactRecord(input.details, secrets) : input.details,
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
