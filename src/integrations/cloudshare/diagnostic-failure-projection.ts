import {
  CloudShareAuthError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareErrorAcrossBoundaries,
} from "./errors";

export interface CloudShareFailureEvidence {
  readonly request: Record<string, unknown> | null;
  readonly response: Record<string, unknown> | null;
}

/**
 * Converts a typed CloudShare failure into protected diagnostic evidence.
 * OAuth exchanges are deliberately metadata-only: their headers and bodies can
 * contain client credentials and access tokens, so neither direction is stored.
 */
export function projectCloudShareFailureEvidence(error: unknown): CloudShareFailureEvidence | undefined {
  if (!isCloudShareFailure(error)) return undefined;
  return projectCloudShareFailureContext((error as { context?: Record<string, unknown> }).context);
}

export function projectCloudShareFailureContext(context: Record<string, unknown> | undefined): CloudShareFailureEvidence | undefined {
  if (!context) return undefined;
  if (context.path === "/oauth/token" || context.integrationSurface === "cloudshare.v4.oauth.token") {
    return { request: null, response: null };
  }
  return {
    request: {
      method: context.method,
      path: context.path,
      query: context.requestQuery,
      headers: context.requestHeaders,
      body: context.requestBody,
    },
    response: {
      status: context.responseStatus ?? context.status,
      headers: context.responseHeaders,
      body: context.responseBody,
      cause: context.cause,
      transport: context.transport,
      network: context.network,
      tls: context.tls,
    },
  };
}

function isCloudShareFailure(error: unknown): error is Error & { context?: Record<string, unknown> } {
  return error instanceof CloudShareAuthError ||
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    isCloudShareErrorAcrossBoundaries(error);
}
