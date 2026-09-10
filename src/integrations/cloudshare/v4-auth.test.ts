import { describe, it, expect, vi } from "vitest";
import { createV4TokenAcquisitionNoopObserver, createV4TokenProvider, type V4TokenAcquisitionEvent } from "./v4-auth";
import { createCloudShareWorkflowSequenceAllocator } from "@/ports/cloudshare-observation";
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

    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition: createV4TokenAcquisitionNoopObserver() });
    const token = await provider.getToken();

    expect(token).toBe("jwt-abc");
    const req = send.mock.calls[0][0];
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://use.cloudshare.com/api/v4/oauth/token");
    expect(req.body).toContain("grant_type=client_credentials");
    expect(req.body).toContain("client_id=client-1");
    expect(req.timeoutMs).toBe(10_000);
  });

  it("allows the authenticated token exchange timeout to be configured", async () => {
    const { http } = stubHttp([tokenResponse("jwt-abc")]);
    const send = vi.spyOn(http, "send");
    await createV4TokenProvider({ ...baseOpts, http, timeoutMs: 125, onAcquisition: createV4TokenAcquisitionNoopObserver() }).getToken();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", timeoutMs: 125 }));
  });

  it("emits metadata-only acquisition evidence", async () => {
    const { http } = stubHttp([tokenResponse("jwt-abc")]);
    const onAcquisition = vi.fn();
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition, now: () => 1_000_000 });

    await provider.getToken();

    expect(onAcquisition).toHaveBeenCalledWith({
      exchangeCorrelationId: expect.any(String),
      occurredAt: "1970-01-01T00:16:40.000Z", outcome: "success", status: 200,
      durationMs: 0, integrationSurface: "cloudshare.v4.oauth.token",
    });
    expect(JSON.stringify(onAcquisition.mock.calls)).not.toContain("jwt-abc");
  });

  it("C: token cache hit emits no acquisition and does not re-request before the expiry margin", async () => {
    const { http, calls } = stubHttp([tokenResponse("jwt-1"), tokenResponse("jwt-2")]);
    let nowMs = 1_000_000;
    const provider = createV4TokenProvider({ ...baseOpts, http, now: () => nowMs, onAcquisition: createV4TokenAcquisitionNoopObserver() });

    expect(await provider.getToken()).toBe("jwt-1");
    nowMs += 100_000; // 100s later, well within 300s validity
    expect(await provider.getToken()).toBe("jwt-1");
    expect(calls()).toBe(1);
  });

  it("B: retry acquisitions receive distinct exchange IDs and monotonic workflow-start sequences", async () => {
    const { http } = stubHttp([{ status: 503, body: "busy" }, tokenResponse("jwt-retry")]);
    const events: V4TokenAcquisitionEvent[] = [];
    const provider = createV4TokenProvider({ ...baseOpts, http, attemptStartAllocator: createCloudShareWorkflowSequenceAllocator(), onAcquisition: (event) => { events.push(event); } });
    await expect(provider.getToken()).rejects.toBeInstanceOf(CloudShareAuthError);
    await expect(provider.getToken()).resolves.toBe("jwt-retry");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.exchangeCorrelationId)).toEqual([expect.any(String), expect.any(String)]);
    expect(events[0].exchangeCorrelationId).not.toBe(events[1].exchangeCorrelationId);
    expect(events.map((event) => event.attemptStartSequence)).toEqual([1, 2]);
  });

  it("keeps concurrent out-of-order acquisitions attributed to their own start sequence and timing", async () => {
    const deferred: Array<(response: HttpResponse) => void> = [];
    const http: HttpClient = { send: vi.fn(() => new Promise<HttpResponse>((resolve) => deferred.push(resolve))) };
    let nowMs = 1_000_000;
    const events: Array<Record<string, unknown>> = [];
    const provider = createV4TokenProvider({ ...baseOpts, http, now: () => nowMs, attemptStartAllocator: createCloudShareWorkflowSequenceAllocator(), onAcquisition: (event) => { events.push(event as unknown as Record<string, unknown>); } });
    const first = provider.getToken();
    nowMs += 25;
    const second = provider.getToken();
    expect(deferred).toHaveLength(2);
    nowMs += 75;
    deferred[1](tokenResponse("jwt-2"));
    await second;
    nowMs += 50;
    deferred[0](tokenResponse("jwt-1"));
    await first;
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.attemptStartSequence).sort()).toEqual([1, 2]);
    expect(events.find((event) => event.attemptStartSequence === 1)).toMatchObject({ occurredAt: "1970-01-01T00:16:40.000Z", completedAt: "1970-01-01T00:16:40.150Z", durationMs: 150 });
    expect(events.find((event) => event.attemptStartSequence === 2)).toMatchObject({ occurredAt: "1970-01-01T00:16:40.025Z", completedAt: "1970-01-01T00:16:40.100Z", durationMs: 75 });
    expect(new Set(events.map((event) => event.exchangeCorrelationId)).size).toBe(2);
  });

  it("refreshes aggressively once inside the safety margin before 300s expiry", async () => {
    const { http, calls } = stubHttp([tokenResponse("jwt-1"), tokenResponse("jwt-2")]);
    let nowMs = 1_000_000;
    const provider = createV4TokenProvider({
      ...baseOpts,
      http,
      now: () => nowMs,
      safetyMarginMs: 30_000,
      onAcquisition: createV4TokenAcquisitionNoopObserver(),
    });

    expect(await provider.getToken()).toBe("jwt-1");
    nowMs += 280_000; // 280s in: only 20s left, inside the 30s margin
    expect(await provider.getToken()).toBe("jwt-2");
    expect(calls()).toBe(2);
  });

  it("raises CloudShareAuthError on a non-200 token response", async () => {
    const { http } = stubHttp([{ status: 401, body: "unauthorized" }]);
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition: createV4TokenAcquisitionNoopObserver() });
    const failure = await provider.getToken().catch((error) => error);
    expect(failure).toBeInstanceOf(CloudShareAuthError);
    expect(failure.context.acquisition).toMatchObject({ exchangeCorrelationId: expect.any(String), durationMs: expect.any(Number), status: 401, failureMode: "http_failure" });
  });

  it.each([
    ["transport", new Error("ETIMEDOUT"), "transport_failure", "timeout"],
    ["http", { status: 503, body: "secret provider body" }, "http_failure", undefined],
    ["malformed JSON", { status: 200, body: "not-json" }, "unexpected_response", "invalid_json"],
    ["schema mismatch", { status: 200, body: JSON.stringify({ access_token: "secret", expires_in: 300 }) }, "unexpected_response", "invalid_schema"],
  ])("emits safe %s failure metadata", async (_label, response, failureMode, causeClassification) => {
    const { http } = response instanceof Error ? { http: { send: vi.fn().mockRejectedValue(response) } as HttpClient } : stubHttp([response as HttpResponse]);
    const onAcquisition = vi.fn();
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition });
    await expect(provider.getToken()).rejects.toBeInstanceOf(CloudShareAuthError);
    expect(onAcquisition).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure", failureMode, ...(causeClassification ? { causeClassification } : {}) }));
    expect(JSON.stringify(onAcquisition.mock.calls)).not.toContain("secret provider body");
  });

  it("raises CloudShareRateLimitError on a throttled token response with retry headers", async () => {
    const { http } = stubHttp([
      {
        status: 429,
        body: "too many requests",
        headers: { "Retry-After": "7", "X-RateLimit-Remaining": "0" },
      },
    ]);
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition: createV4TokenAcquisitionNoopObserver() });

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
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition: createV4TokenAcquisitionNoopObserver() });

    await expect(provider.getToken()).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 403,
      classification: "abuse_protection",
      retryAfterSeconds: 60,
    });
  });

  it("raises CloudShareAuthError on a malformed token body", async () => {
    const { http } = stubHttp([{ status: 200, body: "{\"not\":\"a token\"}" }]);
    const provider = createV4TokenProvider({ ...baseOpts, http, onAcquisition: createV4TokenAcquisitionNoopObserver() });
    await expect(provider.getToken()).rejects.toBeInstanceOf(CloudShareAuthError);
  });
});
