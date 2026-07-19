export interface ProtectedCloudShareExchange {
  readonly request: Record<string, unknown>;
  readonly response: Record<string, unknown> | null;
  readonly transport: Record<string, unknown> | null;
}

/**
 * Maps a captured CloudShare failure into the protected DiagnosticLogEntry
 * exchange shape. This module is intentionally not used by ordinary logs.
 */
export function projectProtectedCloudShareExchange(
  diagnostic: Record<string, unknown>,
): ProtectedCloudShareExchange {
  return {
    request: {
      method: diagnostic.method,
      path: diagnostic.path,
      ...(diagnostic.requestQuery !== undefined ? { query: diagnostic.requestQuery } : {}),
      ...(diagnostic.requestHeaders !== undefined ? { headers: diagnostic.requestHeaders } : {}),
      ...(diagnostic.requestBody !== undefined ? { body: diagnostic.requestBody } : {}),
    },
    response: hasResponseEvidence(diagnostic)
      ? {
          ...(diagnostic.responseStatus !== undefined ? { status: diagnostic.responseStatus } : {}),
          ...(diagnostic.responseHeaders !== undefined ? { headers: diagnostic.responseHeaders } : {}),
          ...(diagnostic.responseBody !== undefined ? { body: diagnostic.responseBody } : {}),
          ...(diagnostic.network !== undefined ? { network: diagnostic.network } : {}),
          ...(diagnostic.tls !== undefined ? { tls: diagnostic.tls } : {}),
        }
      : null,
    transport: hasTransportEvidence(diagnostic)
      ? {
          ...(diagnostic.cause !== undefined ? { cause: diagnostic.cause } : {}),
          ...(diagnostic.network !== undefined ? { network: diagnostic.network } : {}),
          ...(diagnostic.tls !== undefined ? { tls: diagnostic.tls } : {}),
        }
      : null,
  };
}

function hasResponseEvidence(diagnostic: Record<string, unknown>): boolean {
  return diagnostic.responseStatus !== undefined ||
    diagnostic.responseHeaders !== undefined ||
    diagnostic.responseBody !== undefined;
}

function hasTransportEvidence(diagnostic: Record<string, unknown>): boolean {
  return diagnostic.cause !== undefined || diagnostic.network !== undefined || diagnostic.tls !== undefined;
}
