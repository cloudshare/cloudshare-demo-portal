/**
 * Structured logging for the portal. Every log line is JSON with `level`,
 * `message`, `timestamp` and arbitrary structured fields.
 *
 * Secret redaction is a hard requirement: known secret values are scrubbed from
 * the serialised output wherever they appear, so API keys and tokens can never
 * leak into the audit trail (even when embedded in a larger string).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Secret values to redact from all output. */
  secrets: string[];
  /** Where serialised lines are written. Defaults to stdout. */
  sink?: (line: string) => void;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const REDACTED = "[REDACTED]";

function redact(serialised: string, secrets: string[]): string {
  let out = serialised;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}

function projectGenericLogFields(value: unknown, inRequest = false): unknown {
  if (Array.isArray(value)) return value.map((item) => projectGenericLogFields(item, inRequest));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    if (/^(?:error|errorMessage|message|reason|cause|issues|stack)$/i.test(key)) return [];
    if (/^(?:body|requestBody|responseBody|query|requestQuery|payload|webhookPayload|requestBodySummary|webhookEnvelope)$/i.test(key)) return [];
    if (/^response$/i.test(key)) return [[key, projectGenericLogResponse(child)]];
    const nextInRequest = inRequest || /^request$/i.test(key);
    if (/^(?:requestHeaders|responseHeaders)$/i.test(key) || (nextInRequest && /^headers$/i.test(key))) {
      return [[key, maskLogHeaderValues(child)]];
    }
    return [[key, projectGenericLogFields(child, nextInRequest)]];
  }));
}

function projectGenericLogResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const safe = /^(?:status|statusCode|network|tls|transport|failureMode)$/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    if (/^(?:headers|responseHeaders)$/i.test(key)) return [[key, maskLogHeaderValues(child)]];
    return safe.test(key) ? [[key, projectGenericLogFields(child)]] : [];
  }));
}

function maskLogHeaderValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => Array.isArray(entry) && entry.length === 2 ? [entry[0], REDACTED] : maskLogHeaderValues(entry));
  if (!value || typeof value !== "object") return REDACTED;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((key) => [key, REDACTED]));
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(line + "\n"));
  const secrets = options.secrets.filter((s) => s.length > 0);

  function emit(level: LogLevel, message: string, fields?: LogFields): void {
    const line = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(projectGenericLogFields(fields) as LogFields | undefined),
    });
    sink(redact(line, secrets));
  }

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
