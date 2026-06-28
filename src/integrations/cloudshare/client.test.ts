import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createCloudShareClient } from "./client";
import { createFixtureHttpClient, loadFixturesFromDir } from "./fixtures";
import { pingCloudShareV3 } from "./ping";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "./errors";
import type { HttpClient, HttpRequest, HttpResponse } from "./http";
import type { V4TokenProvider } from "./v4-auth";

const endpoints = {
  v4BaseUrl: "https://api.accelerate.cloudshare.com/v4",
  v3BaseUrl: "https://use.cloudshare.com/api/v3",
};

const stubTokenProvider: V4TokenProvider = { getToken: async () => "test-bearer" };

/** HttpClient that records the last request and returns a fixed response. */
function capturingHttp(response: HttpResponse): {
  http: HttpClient;
  last: () => HttpRequest | undefined;
} {
  let last: HttpRequest | undefined;
  return {
    http: {
      async send(request) {
        last = request;
        return response;
      },
    },
    last: () => last,
  };
}

const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
const projectsSchema = z.array(z.object({ id: z.string(), name: z.string() }));

function clientWith(http: HttpClient) {
  return createCloudShareClient({
    http,
    endpoints,
    tokenProvider: stubTokenProvider,
    v3: { apiId: "api-id", apiKey: "api-key" },
    newToken: () => "tokfixed01",
    now: () => 1_700_000_000_000,
  });
}

describe("createCloudShareClient — v4", () => {
  it("returns schema-validated data and sends a Bearer token", async () => {
    const { http, last } = capturingHttp(ok([{ id: "p1", name: "Proj" }]));
    const client = clientWith(http);

    const data = await client.requestV4({
      method: "GET",
      path: "/projects",
      schema: projectsSchema,
    });

    expect(data).toEqual([{ id: "p1", name: "Proj" }]);
    expect(last()?.url).toBe("https://api.accelerate.cloudshare.com/v4/projects");
    expect(last()?.headers?.authorization).toBe("Bearer test-bearer");
  });

  it("emits support diagnostic request bodies while retaining training passphrases", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(ok({ id: "training-1" }));
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
      customerId: "customer-helios",
    });

    await client.requestV4({
      method: "POST",
      path: "/trainings",
      body: {
        Name: "Exam GCP-ASSOC",
        Passphrase: "certalis-attempt-1",
        MainInstructor: { Email: "instructor@example.com" },
      },
      schema: z.object({ id: z.string() }),
    });

    expect(trace).toHaveBeenNthCalledWith(1, {
      level: "info",
      message: "cloudshare request sent",
      fields: expect.objectContaining({
        method: "POST",
        path: "/v4/trainings",
        integrationSurface: "cloudshare.v4",
        customerId: "customer-helios",
        requestHeaders: {
          authorization: "[REDACTED]",
          "content-type": "application/json",
        },
        requestBody: {
          Name: "Exam GCP-ASSOC",
          Passphrase: "certalis-attempt-1",
          MainInstructor: { Email: "instructor@example.com" },
        },
      }),
    });
  });

  it("still redacts true credentials from support diagnostic request bodies", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(ok({ id: "training-1" }));
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
      customerId: "customer-helios",
    });

    await client.requestV4({
      method: "POST",
      path: "/trainings",
      body: {
        Name: "Exam GCP-ASSOC",
        Passphrase: "certalis-attempt-1",
        ApiKey: "cloudshare-api-key",
        WebhookSecret: "webhook-secret",
        Password: "actual-password",
        Signature: "signed-value",
        Authorization: "Bearer embedded-secret",
        Credential: "credential-secret",
        BearerToken: "token-secret",
        diagnosticNote:
          "Bearer embedded-secret cs_sha1 userapiid:api-id;timestamp:1700000000;token:tokfixed01;hmac:abc123",
      },
      schema: z.object({ id: z.string() }),
    });

    expect(trace).toHaveBeenNthCalledWith(1, {
      level: "info",
      message: "cloudshare request sent",
      fields: expect.objectContaining({
        requestBody: {
          Name: "Exam GCP-ASSOC",
          Passphrase: "certalis-attempt-1",
          ApiKey: "[REDACTED]",
          WebhookSecret: "[REDACTED]",
          Password: "[REDACTED]",
          Signature: "[REDACTED]",
          Authorization: "[REDACTED]",
          Credential: "[REDACTED]",
          BearerToken: "[REDACTED]",
          diagnosticNote: "Bearer [REDACTED] cs_sha1 [REDACTED]",
        },
      }),
    });
  });

  it("retains training passphrases in response diagnostics", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(
      ok({
        id: "training-1",
        Passphrase: "certalis-attempt-1",
        passphrase: "candidate-visible-passphrase",
        ApiKey: "cloudshare-api-key",
      }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
      customerId: "customer-helios",
    });

    await client.requestV4({
      method: "POST",
      path: "/trainings",
      schema: z.object({
        id: z.string(),
        Passphrase: z.string(),
        passphrase: z.string(),
        ApiKey: z.string(),
      }),
    });

    expect(trace).toHaveBeenNthCalledWith(2, {
      level: "info",
      message: "cloudshare response received",
      fields: expect.objectContaining({
        responseBody: JSON.stringify({
          id: "training-1",
          Passphrase: "certalis-attempt-1",
          passphrase: "candidate-visible-passphrase",
          ApiKey: "[REDACTED]",
        }),
      }),
    });
  });

  it("retains sponsored-link login URLs in response diagnostics for admin support evidence", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(
      ok({ loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token" }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
    });

    await client.requestV4({
      method: "POST",
      path: "/trainings/training-1/sponsored-link",
      schema: z.object({ loginUrl: z.string() }),
    });

    const responseTrace = trace.mock.calls[1]?.[0].fields;
    expect(responseTrace).toEqual(
      expect.objectContaining({
        responseBody:
          "{\"loginUrl\":\"https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token\"}",
      }),
    );
  });

  it("retains sponsored-link login URLs in legacy sponsoredLinks response diagnostics for admin support evidence", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(
      ok({ loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/legacy-token" }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
    });

    await client.requestV4({
      method: "POST",
      path: "/sponsoredLinks",
      schema: z.object({ loginUrl: z.string() }),
    });

    const responseTrace = trace.mock.calls[1]?.[0].fields;
    expect(responseTrace).toEqual(
      expect.objectContaining({
        responseBody:
          "{\"loginUrl\":\"https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/legacy-token\"}",
      }),
    );
  });

  it("keeps loginUrl redacted in non-sponsored-link response diagnostics", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(
      ok({ loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/should-redact" }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
    });

    await client.requestV4({
      method: "GET",
      path: "/projects",
      schema: z.object({ loginUrl: z.string() }),
    });

    const responseTrace = trace.mock.calls[1]?.[0].fields;
    expect(JSON.stringify(responseTrace)).not.toContain("should-redact");
    expect(responseTrace).toEqual(
      expect.objectContaining({
        responseBody: "{\"loginUrl\":\"[REDACTED]\"}",
      }),
    );
  });

  it("includes customerId in CloudShare HTTP trace fields for customer-scoped v4 reads", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp(ok({ percentComplete: 80 }));
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
      customerId: "customer-helios",
    });

    await client.requestV4({
      method: "GET",
      path: "/guided-journey/progress/exp-1/student-1",
      schema: z.object({ percentComplete: z.number() }),
    });

    expect(trace).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "cloudshare request sent",
        fields: expect.objectContaining({
          customerId: "customer-helios",
          path: "/v4/guided-journey/progress/exp-1/student-1",
          integrationSurface: "cloudshare.v4",
        }),
      }),
    );
    expect(trace).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "cloudshare response received",
        fields: expect.objectContaining({
          customerId: "customer-helios",
          path: "/v4/guided-journey/progress/exp-1/student-1",
          integrationSurface: "cloudshare.v4",
        }),
      }),
    );
  });

  it("redacts credential-bearing response headers while preserving ordinary TLS support metadata elsewhere", async () => {
    const { http } = capturingHttp({
      status: 200,
      headers: {
        authorization: "Bearer upstream-secret",
        "x-auth-token": "secret-auth-token",
        "x-api-key": "secret-api-key",
        "x-cloudshare-signature": "signature-secret",
        "x-hmac": "hmac-secret",
        "set-cookie": ["session=secret-cookie"],
        "content-type": "application/json",
      },
      body: JSON.stringify({ ok: true }),
      tls: {
        authorized: false,
        authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
      },
    });
    const client = clientWith(http);

    const result = await client.requestV4Detailed!({
      method: "GET",
      path: "/projects",
      schema: z.object({ ok: z.boolean() }),
    });

    expect(result.response).toEqual({
      status: 200,
      headers: {
        authorization: "[REDACTED]",
        "x-auth-token": "[REDACTED]",
        "x-api-key": "[REDACTED]",
        "x-cloudshare-signature": "[REDACTED]",
        "x-hmac": "[REDACTED]",
        "set-cookie": ["[REDACTED]"],
        "content-type": "application/json",
      },
      body: { ok: true },
      tls: {
        authorized: false,
        authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
      },
    });
  });
});

describe("createCloudShareClient — v3", () => {
  it("returns validated data and sends cs_sha1 auth in the Authorization header", async () => {
    const { http, last } = capturingHttp(ok([{ id: "r1", name: "EU" }]));
    const client = clientWith(http);

    const data = await client.requestV3({
      method: "GET",
      path: "/regions",
      schema: projectsSchema,
    });

    expect(data).toEqual([{ id: "r1", name: "EU" }]);
    const url = new URL(last()!.url);
    expect(url.pathname).toBe("/api/v3/regions");
    expect(last()?.headers?.authorization).toMatch(
      /^cs_sha1 userapiid:api-id;timestamp:1700000000;token:tokfixed01;hmac:[0-9a-f]{40}$/,
    );
  });

  it("supports signed text responses for the v3 ping endpoint", async () => {
    const { http, last } = capturingHttp({ status: 200, body: "{\"result\":\"Pong\"}" });
    const client = clientWith(http);

    const body = await client.requestV3Text({
      method: "GET",
      path: "/ping",
    });

    expect(body).toBe("{\"result\":\"Pong\"}");
    const url = new URL(last()!.url);
    expect(url.pathname).toBe("/api/v3/ping");
    expect(last()?.headers?.authorization).toMatch(
      /^cs_sha1 userapiid:api-id;timestamp:1700000000;token:tokfixed01;hmac:[0-9a-f]{40}$/,
    );
  });

  it("includes redacted query parameters in detailed request diagnostics", async () => {
    const { http } = capturingHttp({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    const client = clientWith(http);

    const result = await client.requestV3Detailed!({
      method: "GET",
      path: "/envs/EN123",
      query: { include: "status", token: "secret-token" },
      schema: z.object({ ok: z.boolean() }),
    });

    expect(result.request).toEqual({
      method: "GET",
      path: "/api/v3/envs/EN123",
      query: { include: "status", token: "[REDACTED]" },
      headers: {
        authorization: "[REDACTED]",
      },
    });
    expect(result.response).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    });
  });

  it("emits redacted request and response trace events", async () => {
    const trace = vi.fn();
    const { http } = capturingHttp({ status: 200, body: "{\"result\":\"Pong\"}" });
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      newToken: () => "tokfixed01",
      now: () => 1_700_000_000_000,
      trace,
      customerId: "customer-helios",
    });

    await client.requestV3Text({
      method: "GET",
      path: "/ping",
    });

    expect(trace).toHaveBeenNthCalledWith(1, {
      level: "info",
      message: "cloudshare request sent",
      fields: {
        operation: "cloudshare_http",
        method: "GET",
        host: "use.cloudshare.com",
        path: "/api/v3/ping",
        integrationSurface: "cloudshare.v3",
        customerId: "customer-helios",
        requestHeaders: {
          authorization: "[REDACTED]",
        },
      },
    });
    expect(trace).toHaveBeenNthCalledWith(2, {
      level: "info",
      message: "cloudshare response received",
      fields: {
        operation: "cloudshare_http",
        method: "GET",
        host: "use.cloudshare.com",
        path: "/api/v3/ping",
        integrationSurface: "cloudshare.v3",
        customerId: "customer-helios",
        requestHeaders: {
          authorization: "[REDACTED]",
        },
        responseStatus: 200,
        responseBody: "{\"result\":\"Pong\"}",
      },
    });
  });
});

describe("createCloudShareClient — error mapping", () => {
  it("raises CloudShareRequestError on a non-2xx status", async () => {
    const { http } = capturingHttp({ status: 500, body: "boom" });
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareRequestError);
  });

  it("raises CloudShareResponseError when the body fails schema validation", async () => {
    const { http } = capturingHttp(ok([{ id: 123 }]));
    const client = clientWith(http);
    try {
      await client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema });
      throw new Error("expected requestV4 to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudShareResponseError);
      expect((error as CloudShareResponseError).context).toMatchObject({
        status: 200,
        responseBody: [{ id: 123 }],
      });
    }
  });

  it("maps a transport failure (http.send throws) to CloudShareTransportError", async () => {
    const http: HttpClient = {
      async send() {
        throw new Error("ECONNREFUSED");
      },
    };
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareTransportError);
  });

  it("raises CloudShareResponseError on a non-JSON body", async () => {
    const { http } = capturingHttp({ status: 200, body: "<html>nope" });
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareResponseError);
  });

  it("retains parsed redacted JSON error bodies in request-error context", async () => {
    const { http } = capturingHttp({
      status: 403,
      body: JSON.stringify({
        error: "forbidden",
        apiKey: "secret-key",
        authorization: "Bearer secret-bearer-token",
        credential: "credential-secret",
        message:
          "Bearer secret-bearer-token cs_sha1 userapiid:api-id;timestamp:1700000000;token:tokfixed01;hmac:abc123",
      }),
      headers: { "content-type": "application/json" },
    });
    const client = clientWith(http);

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        responseBody: {
          error: "forbidden",
          apiKey: "[REDACTED]",
          authorization: "[REDACTED]",
          credential: "[REDACTED]",
          message: "Bearer [REDACTED] cs_sha1 [REDACTED]",
        },
      }),
    });
  });

  it("retains raw text error bodies when they are not JSON", async () => {
    const { http } = capturingHttp({ status: 500, body: "gateway unavailable" });
    const client = clientWith(http);

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        responseBody: "gateway unavailable",
      }),
    });
  });
});

describe("createCloudShareClient — fixture replay (no live calls)", () => {
  const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
  const fixtureClient = clientWith(createFixtureHttpClient(loadFixturesFromDir(fixturesDir)));

  it("replays a recorded v4 response through the same adapter path", async () => {
    const projects = await fixtureClient.requestV4({
      method: "GET",
      path: "/projects",
      schema: projectsSchema,
    });
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ id: "p-demo-1", name: "Helios CX Project" });
  });

  it("replays a recorded v3 response through the same adapter path", async () => {
    const regions = await fixtureClient.requestV3({
      method: "GET",
      path: "/regions",
      schema: projectsSchema,
    });
    expect(regions).toHaveLength(2);
    expect(regions[1]).toEqual({ id: "r-us-east", name: "US East" });
  });

  it("replays the recorded v3 ping response for fixture-mode connection checks", async () => {
    await expect(pingCloudShareV3(fixtureClient)).resolves.toBe("pong");
  });
});
