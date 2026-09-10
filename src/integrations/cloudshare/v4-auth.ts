import { z } from "zod";
import { CloudShareAuthError, CloudShareRateLimitError } from "./errors";
import { randomUUID } from "node:crypto";
import { HttpTransportError, type HttpClient } from "./http";
import type { CloudShareWorkflowSequenceAllocator } from "@/ports/cloudshare-observation";

/**
 * CloudShare v4 (Accelerate) OAuth. Acquires a Bearer JWT via the
 * `client_credentials` grant and caches it, refreshing aggressively before the
 * ~5-minute (`expires_in: 300`) expiry rather than minting one per call.
 *
 * A safety margin means we refresh slightly early, so an in-flight request
 * never carries a token that expires mid-call.
 */

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
});

export interface V4TokenProvider {
  /** Return a valid Bearer token, acquiring or refreshing as needed. */
  getToken(): Promise<string>;
}

export interface V4TokenAcquisitionEvent {
  readonly exchangeCorrelationId?: string;
  readonly occurredAt: string;
  readonly outcome: "success" | "failure";
  readonly status?: number;
  readonly durationMs: number;
  readonly integrationSurface: "cloudshare.v4.oauth.token";
  readonly failureMode?: "transport_failure" | "http_failure" | "unexpected_response";
  readonly causeClassification?: "timeout" | "dns" | "connection" | "invalid_json" | "invalid_schema" | "unknown";
  readonly attemptStartSequence?: number;
  readonly completedAt?: string;
}

export interface V4TokenProviderOptions {
  readonly http: HttpClient;
  /** v4 API base, e.g. `https://use.cloudshare.com/api/v4`. */
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Current time in epoch ms. Injectable for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Refresh this many ms before the real expiry. Defaults to 30s. */
  readonly safetyMarginMs?: number;
  /** Bound token acquisition so cold/expired authentication cannot outlive reads. */
  readonly timeoutMs?: number;
  readonly onAcquisition: (event: V4TokenAcquisitionEvent) => Promise<void> | void;
  readonly attemptStartAllocator?: CloudShareWorkflowSequenceAllocator;
}

export function createV4TokenAcquisitionNoopObserver(): (event: V4TokenAcquisitionEvent) => void {
  return () => undefined;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

export function createV4TokenProvider(opts: V4TokenProviderOptions): V4TokenProvider {
  const now = opts.now ?? Date.now;
  const safetyMarginMs = opts.safetyMarginMs ?? 30_000;
  let cached: CachedToken | undefined;
  const acquisitionTiming = new Map<string, { readonly attemptStartSequence?: number; readonly startedAtMs: number }>();

  function isFresh(token: CachedToken | undefined): token is CachedToken {
    return token !== undefined && now() < token.expiresAtMs - safetyMarginMs;
  }

  async function acquire(): Promise<CachedToken> {
    const startedAtMs = now();
    const exchangeCorrelationId = randomUUID();
    const attemptStartSequence = opts.attemptStartAllocator?.next();
    acquisitionTiming.set(exchangeCorrelationId, { attemptStartSequence, startedAtMs });
    const acquisitionMetadata = (event: Pick<V4TokenAcquisitionEvent, "durationMs" | "status" | "failureMode" | "causeClassification">) => ({ acquisition: { exchangeCorrelationId, durationMs: event.durationMs, ...(attemptStartSequence === undefined ? {} : { attemptStartSequence }), ...(event.status === undefined ? {} : { status: event.status }), ...(event.failureMode ? { failureMode: event.failureMode } : {}), ...(event.causeClassification ? { causeClassification: event.causeClassification } : {}) } });
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }).toString();

    let response;
    try {
      response = await opts.http.send({
        method: "POST",
        url: `${opts.baseUrl}/oauth/token`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        timeoutMs: opts.timeoutMs ?? 10_000,
      });
    } catch (cause) {
      const durationMs = Math.max(0, now() - startedAtMs);
      const causeClassification = classifyTransportCause(cause);
      await notifyAcquisition({
        exchangeCorrelationId,
        occurredAt: new Date(startedAtMs).toISOString(),
        outcome: "failure",
        durationMs,
        integrationSurface: "cloudshare.v4.oauth.token",
        failureMode: "transport_failure",
        causeClassification,
      });
      throw new CloudShareAuthError("v4 token request failed to send", {
        method: "POST",
        path: "/oauth/token",
        integrationSurface: "cloudshare.v4.oauth.token",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        requestBody: body,
        cause: cause instanceof Error ? cause.message : String(cause),
        ...(cause instanceof HttpTransportError && cause.network ? { network: cause.network } : {}),
        ...acquisitionMetadata({ durationMs, failureMode: "transport_failure", causeClassification }),
      });
    }

    if (response.status !== 200) {
      const durationMs = Math.max(0, now() - startedAtMs);
      await notifyAcquisition({
        exchangeCorrelationId,
        occurredAt: new Date(startedAtMs).toISOString(),
        outcome: "failure",
        status: response.status,
        durationMs,
        integrationSurface: "cloudshare.v4.oauth.token",
        failureMode: "http_failure",
      });
      const rateLimitClassification = classifyTokenRateLimit(response.status, response.body);
      if (rateLimitClassification) {
        const rateLimitHeaders = extractRateLimitHeaders(response.headers);
        const retryAfterSeconds = parseRetryAfterSeconds(response.headers, now);
        throw new CloudShareRateLimitError(
          "v4 token endpoint returned a rate-limit status",
          response.status,
          rateLimitClassification,
          {
            method: "POST",
            path: "/oauth/token",
            integrationSurface: "cloudshare.v4.oauth.token",
            requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
            requestBody: body,
            status: response.status,
            responseStatus: response.status,
            ...(rateLimitHeaders ? { responseHeaders: rateLimitHeaders, rateLimitHeaders } : {}),
            responseBody: response.body,
            ...(response.network ? { network: response.network } : {}),
            ...acquisitionMetadata({ durationMs, status: response.status, failureMode: "http_failure" }),
            ...(retryAfterSeconds !== undefined
              ? { retryAfterSeconds }
              : {}),
          },
        );
      }
      throw new CloudShareAuthError("v4 token endpoint returned a non-200 status", {
        method: "POST",
        path: "/oauth/token",
        integrationSurface: "cloudshare.v4.oauth.token",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        requestBody: body,
        status: response.status,
        responseHeaders: response.headers,
        responseBody: response.body,
        ...(response.network ? { network: response.network } : {}),
        ...acquisitionMetadata({ durationMs, status: response.status, failureMode: "http_failure" }),
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      const durationMs = Math.max(0, now() - startedAtMs);
      await notifyAcquisition({ exchangeCorrelationId, occurredAt: new Date(startedAtMs).toISOString(), outcome: "failure", status: response.status, durationMs, integrationSurface: "cloudshare.v4.oauth.token", failureMode: "unexpected_response", causeClassification: "invalid_json" });
      throw new CloudShareAuthError("v4 token response was not valid JSON", {
        method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" }, requestBody: body,
        status: response.status, responseHeaders: response.headers, responseBody: response.body,
        ...acquisitionMetadata({ durationMs, status: response.status, failureMode: "unexpected_response", causeClassification: "invalid_json" }),
      });
    }

    const parsed = tokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      const durationMs = Math.max(0, now() - startedAtMs);
      await notifyAcquisition({ exchangeCorrelationId, occurredAt: new Date(startedAtMs).toISOString(), outcome: "failure", status: response.status, durationMs, integrationSurface: "cloudshare.v4.oauth.token", failureMode: "unexpected_response", causeClassification: "invalid_schema" });
      throw new CloudShareAuthError("v4 token response did not match the expected schema", {
        method: "POST", path: "/oauth/token", integrationSurface: "cloudshare.v4.oauth.token",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" }, requestBody: body,
        status: response.status, responseHeaders: response.headers, responseBody: response.body,
        issues: parsed.error.issues.map((i) => i.message),
        ...acquisitionMetadata({ durationMs, status: response.status, failureMode: "unexpected_response", causeClassification: "invalid_schema" }),
      });
    }

    const durationMs = Math.max(0, now() - startedAtMs);
    await notifyAcquisition({
      exchangeCorrelationId,
      occurredAt: new Date(startedAtMs).toISOString(),
      outcome: "success",
      status: response.status,
      durationMs,
      integrationSurface: "cloudshare.v4.oauth.token",
    });

    return {
      accessToken: parsed.data.access_token,
      expiresAtMs: now() + parsed.data.expires_in * 1000,
    };
  }

  return {
    async getToken(): Promise<string> {
      if (isFresh(cached)) {
        return cached.accessToken;
      }
      cached = await acquire();
      return cached.accessToken;
    },
  };

  async function notifyAcquisition(event: V4TokenAcquisitionEvent): Promise<void> {
    try {
      const timing = event.exchangeCorrelationId ? acquisitionTiming.get(event.exchangeCorrelationId) : undefined;
      await opts.onAcquisition({ ...event, ...(timing?.attemptStartSequence === undefined ? {} : { attemptStartSequence: timing.attemptStartSequence, completedAt: event.completedAt ?? new Date(now()).toISOString() }) });
    } catch {
      // Diagnostics must not break CloudShare authentication.
    }
  }
}

function classifyTransportCause(cause: unknown): "timeout" | "dns" | "connection" | "unknown" {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/timeout|timed out|abort|ETIMEDOUT/i.test(message)) return "timeout";
  if (/dns|ENOTFOUND|EAI_AGAIN/i.test(message)) return "dns";
  if (/connect|ECONN|socket/i.test(message)) return "connection";
  return "unknown";
}


function classifyTokenRateLimit(
  status: number,
  body: string,
): "rate_limit" | "abuse_protection" | null {
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 403 && /\babuse(?:\s|-)?(?:list|protection)\b/i.test(body)) {
    return "abuse_protection";
  }
  return null;
}

function extractRateLimitHeaders(
  headers: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> | undefined {
  if (!headers) {
    return undefined;
  }

  const result = Object.fromEntries(
    Object.entries(headers).filter(([key]) => /retry-after|rate.?limit|throttle/i.test(key)),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseRetryAfterSeconds(
  headers: Record<string, string | string[]> | undefined,
  now: () => number,
): number | undefined {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) {
    return undefined;
  }

  const numeric = Number(first);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  const retryAt = Date.parse(first);
  if (!Number.isNaN(retryAt)) {
    const seconds = Math.ceil((retryAt - now()) / 1_000);
    return seconds > 0 ? seconds : 0;
  }

  return undefined;
}
