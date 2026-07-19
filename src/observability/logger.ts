import { projectOrdinaryLogFields } from "./ordinary-log-projection";

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

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(line + "\n"));
  const secrets = options.secrets.filter((s) => s.length > 0);

  function emit(level: LogLevel, message: string, fields?: LogFields): void {
    const line = JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...projectOrdinaryLogFields(fields),
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
