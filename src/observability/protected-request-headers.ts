const REDACTED = "[REDACTED]";

const SAFE_OPERATIONAL_HEADERS = new Set([
  "accept", "acceptencoding", "acceptlanguage", "contentlength", "contenttype",
  "correlationid", "requestid", "traceparent", "tracestate", "useragent",
  "xcorrelationid", "xrequestid",
]);

function compactHeaderName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Shared classifier for request-header evidence in protected diagnostics. */
export function isCredentialBearingRequestHeader(name: string): boolean {
  const compact = compactHeaderName(name);
  if (SAFE_OPERATIONAL_HEADERS.has(compact)) return false;

  return compact.includes("authorization")
    || compact.includes("authentication")
    || compact.includes("apikey")
    || compact.includes("subscriptionkey")
    || compact.includes("accesskey")
    || compact.includes("cloudsharekey")
    || compact.includes("credential")
    || compact.includes("bearer")
    || /(?:auth|secret|token|signature\d*|cookie\d*)$/.test(compact);
}

/**
 * Project request headers for protected diagnostics. Map and tuple shapes keep
 * safe operational values; malformed/scalar shapes are masked conservatively.
 */
export function projectProtectedRequestHeaders<T>(value: T): T {
  if (value === undefined) return value;
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
