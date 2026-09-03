import { describe, it, expect, vi } from "vitest";
import { createV4TokenProvider } from "./v4-auth";
import { CloudShareAuthError, CloudShareRateLimitError } from "./errors";
import type { HttpClient, HttpResponse } from "./http";

const tokenResponse = (accessToken: string, expiresIn = 300): HttpResponse => ({
  status: 200,
  body: JSON.stringify({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
  }),
});

function stubHttp(responses: HttpResponse[]): { http: HttpClient; calls: () => number } {
  let i = 0;
  const send = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]);
  return { http: { send }, calls: () => send.mock.calls.length };
}

const baseOpts = {
  baseUrl: "https://use.cloudshare.com/api/v4",
  clientId: "client-1",
  clientSecret: "secret-1",
};

describe("createV4TokenProvider", () => {
  it("acquires a bearer token via client_credentials and returns it", async () => {
    const { http } = stubHttp([tokenResponse("jwt-abc")]);
    const send = vi.spyOn(http, "send");

    const provider = createV4TokenProvider({ ...baseOpts, http });
    const token = await provider.getToken();

    expect(token).toBe("jwt-abc");
    const req = send.mock.calls[0][0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://use.cloudshare.com/api/v4/oauth/token");
    expect(req.body).toContain("grant_type=client_credentials");
    expect(req.body).toContain("client_id=client-1");
  });

  it("emits metadata-only acquisition evidence", async () => {
    const { http } = stubHttp([tokenResponse("jwt-abc")]);
    const onAcquisition = vi.fn();
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition, now: () => 1_000_000 });

    await provider.getToken();

    expect(onAcquisition).toHaveBeenCalledWith({
      occurredAt: "1970-01-01T00:16:40.000Z", outcome: "success", status: 200,
      durationMs: 0, integrationSurface: "cloudshare.v4.oauth.token",
    });
    expect(JSON.stringify(onAcquisition.mock.calls)).not.toContain("jwt-abc");
  });

  it("caches the token and does not re-request before the expiry margin", async () => {
    const { http, calls } = stubHttp([tokenResponse("jwt-1"), tokenResponse("jwt-2")]);
    let nowMs = 1_000_000;
    const provider = createV4TokenProvider({ ...baseOpts, http, now: () => nowMs });

    expect(await provider.getToken()).toBe("jwt-1");
    nowMs += 100_000; // 100s later, well within 300s validity
    expect(await provider.getToken()).toBe("jwt-1");
    expect(calls()).toBe(1);
  });

  it("refreshes aggressively once inside the safety margin before 300s expiry", async () => {
    const { http, calls } = stubHttp([tokenResponse("jwt-1"), tokenResponse("jwt-2")]);
    let nowMs = 1_000_000;
    const provider = createV4TokenProvider({
      ...baseOpts,
      http,
      now: () => nowMs,
      safetyMarginMs: 30_000,
    });

    expect(await provider.getToken()).toBe("jwt-1");
    nowMs += 280_000; // 280s in: only 20s left, inside the 30s margin
    expect(await provider.getToken()).toBe("jwt-2");
    expect(calls()).toBe(2);
  });

  it("raises CloudShareAuthError on a non-200 token response", async () => {
    const { http } = stubHttp([{ status: 401, body: "unauthorized" }]);
    const provider = createV4TokenProvider({ ...baseOpts, http });
    await expect(provider.getToken()).rejects.toBeInstanceOf(CloudShareAuthError);
  });

  it("raises CloudShareRateLimitError on a throttled token response with retry headers", async () => {
    const { http } = stubHttp([
      {
        status: 429,
        body: "too many requests",
        headers: { "Retry-After": "7", "X-RateLimit-Remaining": "0" },
      },
    ]);
    const provider = createV4TokenProvider({ ...baseOpts, http });

    const result = provider.getToken();
    await expect(result).rejects.toBeInstanceOf(CloudShareRateLimitError);
    await expect(result).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 429,
      classification: "rate_limit",
      retryAfterSeconds: 7,
      rateLimitHeaders: {
        "Retry-After": "7",
        "X-RateLimit-Remaining": "0",
      },
      context: {
        method: "POST",
        path: "/oauth/token",
        integrationSurface: "cloudshare.v4.oauth.token",
        requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
        requestBody: "grant_type=client_credentials&client_id=client-1&client_secret=secret-1",
        responseBody: "too many requests",
      },
    });
  });

  it("classifies explicit v4 token abuse-protection responses", async () => {
    const { http } = stubHttp([
      {
        status: 403,
        body: "Blocked by abuse protection list",
        headers: { "Retry-After": "60" },
      },
    ]);
    const provider = createV4TokenProvider({ ...baseOpts, http });

    await expect(provider.getToken()).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 403,
      classification: "abuse_protection",
      retryAfterSeconds: 60,
    });
  });

  it("raises CloudShareAuthError on a malformed token body", async () => {
    const { http } = stubHttp([{ status: 200, body: "{\"not\":\"a token\"}" }]);
    const provider = createV4TokenProvider({ ...baseOpts, http });
    await expect(provider.getToken()).rejects.toBeInstanceOf(CloudShareAuthError);
  });
});
