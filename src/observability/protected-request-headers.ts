const REDACTED = "[REDACTED]";

const SAFE_OPERATIONAL_HEADERS = new Set([
  "accept", "acceptencoding", "contentlength", "contenttype",
  "correlationid", "requestid", "traceparent", "tracestate", "useragent",
  "xcorrelationid", "xrequestid",
]);

function compactHeaderName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Shared fail-closed classifier for request-header evidence in protected
 * diagnostics. Only the explicit operational allowlist is non-credential data.
 */
export function isCredentialBearingRequestHeader(name: string): boolean {
  const compact = compactHeaderName(name);
  return !SAFE_OPERATIONAL_HEADERS.has(compact);
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
      ? [entry[0], isCredentialBearingRequestHeader(String(entry[0])) ? REDACTED : entry[1]]
      : projectProtectedRequestHeaders(entry)) as T;
  }
  if (!value || typeof value !== "object") return REDACTED as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, child]) => [
    name,
    isCredentialBearingRequestHeader(name) ? REDACTED : child,
  ])) as T;
}
