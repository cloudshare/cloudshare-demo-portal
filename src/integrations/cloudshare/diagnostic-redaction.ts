/**
 * Compatibility adapter for older CloudShare call sites.
 *
 * Protected diagnostic body evidence is intentionally opaque: passphrase,
 * accessLink, loginUrl, token, and any analogous nested provider/request value
 * must reach the domain recorder unchanged. Request-header masking belongs to
 * the recorder's direction-aware seam, where the structure is known.
 */
export interface CloudShareDiagnosticRedactionOptions {
  readonly preserveSponsoredLinkLoginUrl?: boolean;
  readonly redactTokenLikeKeys?: boolean;
}

export function redactCloudShareAdminSupportValue(
  value: unknown,
  _options: CloudShareDiagnosticRedactionOptions = {},
): unknown {
  return value;
}

/**
 * Projection for ordinary process logs. Protected HTTP bodies and provider
 * payloads belong only in Customer-scoped DiagnosticLogEntry storage.
 */
export function projectCloudShareGenericLogValue(value: unknown): unknown {
  return projectGeneric(value, false);
}

function projectGeneric(value: unknown, inRequest: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => projectGeneric(item, inRequest));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).flatMap(([key, child]) => {
    if (/^(?:error|errorMessage|message|reason|cause|issues|stack)$/i.test(key)) return [];
    if (/^(?:body|requestBody|responseBody|query|requestQuery|payload|webhookPayload|requestBodySummary|webhookEnvelope)$/i.test(key)) return [];
    if (/^response$/i.test(key)) return [[key, projectGenericResponse(child)]];
    const nextInRequest = inRequest || /^request$/i.test(key);
    if (/^(?:requestHeaders|responseHeaders)$/i.test(key) || (nextInRequest && /^headers$/i.test(key))) {
      return [[key, maskHeaderValues(child)]];
    }
    return [[key, projectGeneric(child, nextInRequest)]];
  }));
}

function projectGenericResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const safe = /^(?:status|statusCode|network|tls|transport|failureMode)$/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    if (/^(?:headers|responseHeaders)$/i.test(key)) return [[key, maskHeaderValues(child)]];
    return safe.test(key) ? [[key, projectGeneric(child, false)]] : [];
  }));
}

function maskHeaderValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => Array.isArray(entry) && entry.length === 2
      ? [entry[0], "[REDACTED]"]
      : maskHeaderValues(entry));
  }
  if (!value || typeof value !== "object") return "[REDACTED]";
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).map((key) => [key, "[REDACTED]"]));
}
