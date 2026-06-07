import { z } from "zod";
import { CloudShareAuthError } from "./errors";
import type { HttpClient } from "./http";

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
