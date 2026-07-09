import { z } from "zod";
import { CloudShareAuthError, CloudShareRateLimitError } from "./errors";
import type { HttpClient } from "./http";
import { redactCloudShareAdminSupportValue } from "./diagnostic-redaction";

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
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

export function createV4TokenProvider(opts: V4TokenProviderOptions): V4TokenProvider {
  const now = opts.now ?? Date.now;
  const safetyMarginMs = opts.safetyMarginMs ?? 30_000;
  let cached: CachedToken | undefined;

  function isFresh(token: CachedToken | undefined): token is CachedToken {
    return token !== undefined && now() < token.expiresAtMs - safetyMarginMs;
  }

  async function acquire(): Promise<CachedToken> {
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
      });
    } catch (cause) {
      throw new CloudShareAuthError("v4 token request failed to send", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    if (response.status !== 200) {
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
            requestBody: redactTokenRequestBody(body),
            status: response.status,
            responseStatus: response.status,
            ...(rateLimitHeaders ? { responseHeaders: rateLimitHeaders, rateLimitHeaders } : {}),
            responseBody: redactCloudShareAdminSupportValue(response.body),
            ...(retryAfterSeconds !== undefined
              ? { retryAfterSeconds }
              : {}),
          },
        );
      }
      throw new CloudShareAuthError("v4 token endpoint returned a non-200 status", {
        status: response.status,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new CloudShareAuthError("v4 token response was not valid JSON");
    }

    const parsed = tokenResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new CloudShareAuthError("v4 token response did not match the expected schema", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

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
}

function redactTokenRequestBody(body: string): string {
  const params = new URLSearchParams(body);
  if (params.has("client_secret")) {
    params.set("client_secret", "[REDACTED]");
  }
  return params.toString();
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
