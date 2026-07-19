const REDACTED = "[REDACTED]";

const SAFE_OPERATIONAL_HEADERS = new Set([
  "accept", "accept-encoding", "content-length", "content-type",
  "correlation-id", "request-id", "traceparent", "tracestate", "user-agent",
  "x-correlation-id", "x-request-id",
]);

function canonicalHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function isSupportedHeaderValue(value: unknown): value is string | string[] {
  return typeof value === "string"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function projectHeaderValue(name: string, value: unknown): unknown {
  return !isCredentialBearingRequestHeader(name) && isSupportedHeaderValue(value)
    ? value
    : REDACTED;
}

/**
 * Shared fail-closed classifier for request-header evidence in protected
 * diagnostics. Only the explicit operational allowlist is non-credential data.
 */
export function isCredentialBearingRequestHeader(name: string): boolean {
  return !SAFE_OPERATIONAL_HEADERS.has(canonicalHeaderName(name));
}

/**
 * Project request headers for protected diagnostics. Map and tuple shapes keep
 * safe operational values; malformed/scalar shapes are masked conservatively.
 */
export function projectProtectedRequestHeaders<T>(value: T): T {
  if (value === undefined) return value;
  if (typeof value === "string") {
    const parsed = /^([^:\r\n]+):(.*)$/.exec(value);
    if (!parsed) return REDACTED as T;
    const [, name] = parsed;
    return (isCredentialBearingRequestHeader(name)
      ? `${name}: ${REDACTED}`
      : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => Array.isArray(entry) && entry.length === 2
      ? [entry[0], projectHeaderValue(String(entry[0]), entry[1])]
      : projectProtectedRequestHeaders(entry)) as T;
  }
  if (!value || typeof value !== "object") return REDACTED as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [
    name,
    projectHeaderValue(name, child),
  ])) as T;
}
