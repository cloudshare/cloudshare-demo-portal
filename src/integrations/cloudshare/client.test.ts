import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createCloudShareClient, type CloudShareRateLimitCooldownStore } from "./client";
import { createFixtureHttpClient, loadFixturesFromDir } from "./fixtures";
import { pingCloudShareV3 } from "./ping";
import {
  CloudShareRateLimitError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "./errors";
import { HttpTransportError, type HttpClient, type HttpRequest, type HttpResponse } from "./http";
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

function createCooldownStore(): CloudShareRateLimitCooldownStore {
  const byCustomerId = new Map<string, {
    untilEpochMs: number;
    classification: "rate_limit" | "abuse_protection";
    retryAfterSeconds?: number;
    rateLimitHeaders?: Record<string, string | string[]>;
  }>();
  return {
    get(customerId) {
      return byCustomerId.get(customerId) ?? null;
    },
    set(customerId, cooldown) {
      byCustomerId.set(customerId, cooldown);
    },
    clear(customerId) {
      byCustomerId.delete(customerId);
    },
  };
}

function sequentialHttp(...responses: HttpResponse[]): { http: HttpClient; calls: () => number } {
  let count = 0;
  return {
    http: {
      async send() {
        const response = responses[Math.min(count, responses.length - 1)];
        count += 1;
        return response;
      },
    },
    calls: () => count,
  };
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

  it("accepts an explicitly documented empty v4 success response while retaining request evidence", async () => {
    const { http, last } = capturingHttp({
      status: 200,
      headers: { "x-correlation-id": "cloud-1" },
      body: "",
    });
    const client = clientWith(http);

    const result = await client.requestV4Detailed!({
      method: "POST",
      path: "/sales/sales-1/participants/invite",
      body: ["participant-1"],
      allowEmptyResponse: true,
      schema: z.void(),
    });

    expect(result).toMatchObject({
      data: undefined,
      request: { method: "POST", path: "/v4/sales/sales-1/participants/invite", body: ["participant-1"] },
      response: { status: 200, headers: { "x-correlation-id": "cloud-1" }, body: "" },
    });
    expect(last()?.headers?.authorization).toBe("Bearer test-bearer");
  });

  it("retains complete Sales Participant request and response bodies in authorised support traces", async () => {
    const trace = vi.fn();
    const participantEmail = "participant-private@example.test";
    const { http } = sequentialHttp(
      ok([{ id: "participant-1", email: participantEmail }]),
      ok({ count: 1, items: [{ id: "participant-1", email: participantEmail }] }),
      { status: 200, body: "" },
    );
    const client = createCloudShareClient({ http, endpoints, tokenProvider: stubTokenProvider, v3: { apiId: "api-id", apiKey: "api-key" }, trace });

    await client.requestV4({ method: "POST", path: "/sales/sales-1/participants", body: [{ firstName: "Private", lastName: "Person", email: participantEmail }], schema: z.array(z.object({ id: z.string(), email: z.string().email() })) });
    await client.requestV4({ method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" }, schema: z.object({ count: z.number(), items: z.array(z.object({ id: z.string(), email: z.string().email() })) }) });
    await client.requestV4({ method: "POST", path: "/sales/sales-1/participants/invite", body: ["participant-1"], allowEmptyResponse: true, schema: z.void() });

    const evidence = JSON.stringify(trace.mock.calls);
    expect(evidence).not.toContain(participantEmail);
    expect(evidence).not.toContain('\\"count\\":1');
    expect(trace.mock.calls.filter(([event]) => event.message === "cloudshare request sent")).toHaveLength(3);
    expect(trace.mock.calls.filter(([event]) => event.message === "cloudshare response received")).toHaveLength(3);
  });

  it("retains the full Sales Participant body when a schema check fails", async () => {
    const participantEmail = "participant-private@example.test";
    const { http } = capturingHttp(ok({ count: 1, items: [{ email: participantEmail }] }));
    const client = clientWith(http);

    const error = await client.requestV4({ method: "GET", path: "/sales/sales-1/participants", query: { offset: "0", limit: "100" }, schema: z.object({ count: z.number(), items: z.array(z.object({ id: z.string(), email: z.string().email() })) }) }).catch((failure) => failure);
    expect(error).toMatchObject({
      name: "CloudShareResponseError",
      context: { status: 200, requestQuery: { offset: "0", limit: "100" }, responseBody: { count: 1, items: [{ email: participantEmail }] } },
    });
    expect(JSON.stringify((error as { context?: unknown }).context)).toContain(participantEmail);
  });

  it("retains full protected evidence for a non-Sales CloudShare response mismatch", async () => {
    const body = { count: 1, items: [{ id: "student-1", email: "student@example.test", providerDetail: { code: "unexpected-shape" } }] };
    const { http } = capturingHttp(ok(body));
    const client = clientWith(http);

    const error = await client.requestV4({
      method: "GET",
      path: "/trainings/training-1/students",
      query: { offset: "0", limit: "100" },
      schema: z.object({ students: z.array(z.object({ id: z.string() })) }),
    }).catch((failure) => failure);

    expect(error).toMatchObject({
      name: "CloudShareResponseError",
      context: {
        requestQuery: { offset: "0", limit: "100" },
        responseBody: body,
      },
    });
  });

  it("retains Sales Participant provider errors while redacting bearer invitation URLs", async () => {
    const participantEmail = "participant-private@example.test";
    const providerParticipantId = "PTYieGdBA4HfAyfI2LhbcxhQ2";
    const providerInviteUrl = "https://use.cloudshare.com/Ent/Login.aspx?token=private-invite";
    const { http } = capturingHttp({
      status: 400,
      body: JSON.stringify({
        email: [`${participantEmail} is not accepted.`],
        participants: [`${providerParticipantId} cannot use ${providerInviteUrl}.`],
        [participantEmail]: ["Participant email was used as an error key."],
        [providerParticipantId]: ["Provider participant ID was used as an error key."],
        [providerInviteUrl]: ["Provider invite URL was used as an error key."],
      }),
    });
    const client = clientWith(http);

    const error = await client.requestV4({
      method: "POST",
      path: "/sales/sales-1/participants/invite",
      body: [providerParticipantId],
      schema: z.void(),
    }).catch((failure) => failure);

    expect(error).toMatchObject({
      name: "CloudShareRequestError",
      status: 400,
      context: {
        responseBody: expect.objectContaining({
          email: [`${participantEmail} is not accepted.`],
          participants: [expect.stringContaining(providerParticipantId)],
        }),
      },
    });
    const evidence = JSON.stringify((error as { context?: unknown }).context);
    expect(evidence).toContain(participantEmail);
    expect(evidence).toContain(providerParticipantId);
    expect(evidence).toContain(providerInviteUrl);
  });

  it("retains training request bodies while masking all request headers", async () => {
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
      }),
    });
    expect(JSON.stringify(trace.mock.calls)).not.toContain("certalis-attempt-1");
  });

  it("retains request body fields regardless of their names", async () => {
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
        method: "POST",
        path: "/v4/trainings",
      }),
    });
    expect(JSON.stringify(trace.mock.calls)).not.toContain("certalis-attempt-1");
    expect(JSON.stringify(trace.mock.calls)).not.toContain("embedded-secret");
  });

  it("retains training response bodies in diagnostics", async () => {
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
        responseStatus: 200,
      }),
    });
    expect(JSON.stringify(trace.mock.calls)).not.toContain("candidate-visible-passphrase");
  });

  it("retains sponsored-link login URLs in protected traces and detailed evidence", async () => {
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

    const detailed = await client.requestV4Detailed!({
      method: "POST",
      path: "/trainings/training-1/sponsored-link",
      schema: z.object({ loginUrl: z.string() }),
    });

    const responseTrace = trace.mock.calls[1]?.[0].fields;
    expect(responseTrace).toEqual(
      expect.objectContaining({
        responseStatus: 200,
      }),
    );
    expect(JSON.stringify(responseTrace)).not.toContain("secret-token");
    expect(detailed.response.body).toEqual({ loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret-token" });
  });

  it("redacts Sales Experience and participant identifiers from ordinary trace paths while retaining detailed evidence", async () => {
    const trace = vi.fn();
    const providerSalesId = "SALES-provider-opaque-1";
    const providerParticipantId = "PART-provider-opaque-9";
    const { http } = sequentialHttp(
      ok({ id: providerSalesId, status: "inProgress" }),
      ok({ count: 1, items: [{ id: providerParticipantId, email: "participant@example.test" }] }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
    });

    const session = await client.requestV4Detailed!({
      method: "GET",
      path: `/sales/${providerSalesId}`,
      schema: z.object({ id: z.string(), status: z.string() }),
    });
    const roster = await client.requestV4Detailed!({
      method: "GET",
      path: `/sales/${providerSalesId}/participants/${providerParticipantId}`,
      schema: z.object({ count: z.number(), items: z.array(z.object({ id: z.string(), email: z.string().email() })) }),
    });

    expect(session.request.path).toBe(`/v4/sales/${providerSalesId}`);
    expect(roster.request.path).toBe(`/v4/sales/${providerSalesId}/participants/${providerParticipantId}`);
    expect(trace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}" }),
    }));
    expect(trace).toHaveBeenNthCalledWith(3, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/participants/{participantId}" }),
    }));
    expect(JSON.stringify(trace.mock.calls)).not.toContain(providerSalesId);
    expect(JSON.stringify(trace.mock.calls)).not.toContain(providerParticipantId);
  });

  it("preserves documented static Sales participant child routes in ordinary trace paths", async () => {
    const trace = vi.fn();
    const providerSalesId = "SALES-provider-opaque-2";
    const { http } = sequentialHttp(
      { status: 200, body: "" },
      ok({ subject: "Invite" }),
      ok({ environmentId: "env-1" }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
    });

    await client.requestV4Detailed!({
      method: "POST",
      path: `/sales/${providerSalesId}/participants/invite`,
      allowEmptyResponse: true,
      schema: z.void(),
    });
    await client.requestV4Detailed!({
      method: "GET",
      path: `/sales/${providerSalesId}/participants/email-template`,
      schema: z.object({ subject: z.string() }),
    });
    await client.requestV4Detailed!({
      method: "GET",
      path: `/sales/${providerSalesId}/participants/unassigned-environment`,
      schema: z.object({ environmentId: z.string() }),
    });

    expect(trace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/participants/invite" }),
    }));
    expect(trace).toHaveBeenNthCalledWith(3, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/participants/email-template" }),
    }));
    expect(trace).toHaveBeenNthCalledWith(5, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/participants/unassigned-environment" }),
    }));
    expect(JSON.stringify(trace.mock.calls)).not.toContain(providerSalesId);
    expect(JSON.stringify(trace.mock.calls)).not.toContain("{participantId}/invite");
    expect(JSON.stringify(trace.mock.calls)).not.toContain("{participantId}/email-template");
  });

  it("redacts documented nested Sales route identifiers while preserving static route names", async () => {
    const trace = vi.fn();
    const providerSalesId = "SALES-provider-opaque-3";
    const providerParticipantId = "PART-provider-opaque-3";
    const providerSalesProId = "SALESPRO-provider-opaque-3";
    const providerPropertyId = "PROPERTY-provider-opaque-3";
    const { http } = sequentialHttp(
      ok({ id: "env-1" }),
      ok({ id: providerSalesProId }),
      ok({ id: providerPropertyId }),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      v3: { apiId: "api-id", apiKey: "api-key" },
      trace,
    });

    await client.requestV4Detailed!({
      method: "GET",
      path: `/sales/${providerSalesId}/students/participants/${providerParticipantId}/environment`,
      schema: z.object({ id: z.string() }),
    });
    await client.requestV4Detailed!({
      method: "PUT",
      path: `/sales/${providerSalesId}/salespros/${providerSalesProId}`,
      schema: z.object({ id: z.string() }),
    });
    await client.requestV4Detailed!({
      method: "GET",
      path: `/sales/${providerSalesId}/users/properties/${providerPropertyId}`,
      schema: z.object({ id: z.string() }),
    });

    expect(trace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/students/participants/{participantId}/environment" }),
    }));
    expect(trace).toHaveBeenNthCalledWith(3, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/salespros/{salesProId}" }),
    }));
    expect(trace).toHaveBeenNthCalledWith(5, expect.objectContaining({
      message: "cloudshare request sent",
      fields: expect.objectContaining({ path: "/v4/sales/{salesId}/users/properties/{propertyId}" }),
    }));
    const evidence = JSON.stringify(trace.mock.calls);
    expect(evidence).not.toContain(providerSalesId);
    expect(evidence).not.toContain(providerParticipantId);
    expect(evidence).not.toContain(providerSalesProId);
    expect(evidence).not.toContain(providerPropertyId);
  });

  it("retains legacy sponsoredLinks URLs in protected traces", async () => {
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
        responseStatus: 200,
      }),
    );
    expect(JSON.stringify(responseTrace)).not.toContain("legacy-token");
  });

  it("retains loginUrl in every provider response diagnostic", async () => {
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
        responseStatus: 200,
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

  it("retains response headers and preserves ordinary TLS support metadata", async () => {
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
        authorization: "Bearer upstream-secret",
        "x-auth-token": "secret-auth-token",
        "x-api-key": "secret-api-key",
        "x-cloudshare-signature": "signature-secret",
        "x-hmac": "hmac-secret",
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

  it("retains query parameters and masks request headers in detailed diagnostics", async () => {
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
      query: { include: "status", token: "secret-token" },
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

  it("emits request-header-masked trace events", async () => {
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
        network: undefined,
        tls: undefined,
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

  it("propagates HTTP transport socket and TLS evidence into CloudShareTransportError", async () => {
    const http: HttpClient = { async send() { throw new HttpTransportError("socket failed", new Error("ECONNRESET"), { transport: "tcp", remoteAddress: "127.0.0.1" }, { protocol: "TLSv1.3", authorized: false }); } };
    await expect(clientWith(http).requestV4({ method: "GET", path: "/projects", schema: projectsSchema })).rejects.toMatchObject({
      context: expect.objectContaining({ network: { transport: "tcp", remoteAddress: "127.0.0.1" }, tls: { protocol: "TLSv1.3", authorized: false } }),
    });
  });

  it("raises CloudShareResponseError on a non-JSON body", async () => {
    const { http } = capturingHttp({ status: 200, body: "<html>nope" });
    const client = clientWith(http);
    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareResponseError);
  });

  it("retains parsed provider JSON error bodies in request-error context", async () => {
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
          apiKey: "secret-key",
          authorization: "Bearer secret-bearer-token",
          credential: "credential-secret",
          message: "Bearer secret-bearer-token cs_sha1 userapiid:api-id;timestamp:1700000000;token:tokfixed01;hmac:abc123",
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

  it("classifies 429 responses as CloudShareRateLimitError and preserves retry headers in diagnostics", async () => {
    const { http } = capturingHttp({
      status: 429,
      headers: {
        "retry-after": "17",
        "x-ratelimit-limit": "120",
        "x-ratelimit-remaining": "0",
      },
      body: JSON.stringify({ error: "Too many requests" }),
    });
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      customerId: "customer-helios",
      cooldownStore: createCooldownStore(),
      v3: { apiId: "api-id", apiKey: "api-key" },
      now: () => 1_700_000_000_000,
      newToken: () => "tokfixed01",
    });

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 429,
      retryAfterSeconds: 17,
      classification: "rate_limit",
      context: expect.objectContaining({
        responseHeaders: expect.objectContaining({
          "retry-after": "17",
          "x-ratelimit-limit": "120",
          "x-ratelimit-remaining": "0",
        }),
      }),
    });
  });

  it("classifies abuse-list responses as CloudShareRateLimitError at the integration boundary", async () => {
    const { http } = capturingHttp({
      status: 403,
      headers: {
        "retry-after": "60",
      },
      body: JSON.stringify({
        error: "Request blocked by abuse protection list",
      }),
    });
    const client = clientWith(http);

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 403,
      retryAfterSeconds: 60,
      classification: "abuse_protection",
    });
  });

  it("does not classify unrelated blocked error text as abuse protection", async () => {
    const { http } = capturingHttp({
      status: 500,
      body: JSON.stringify({
        error: "Environment operation blocked by a backend dependency",
      }),
    });
    const client = clientWith(http);

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      name: "CloudShareRequestError",
      status: 500,
    });
  });

  it("retries a safe GET once rate-limited using Retry-After before succeeding", async () => {
    const sleep = vi.fn(async () => {});
    const { http, calls } = sequentialHttp(
      {
        status: 429,
        headers: { "retry-after": "1" },
        body: JSON.stringify({ error: "Too many requests" }),
      },
      ok([{ id: "p1", name: "Proj" }]),
    );
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      customerId: "customer-helios",
      cooldownStore: createCooldownStore(),
      v3: { apiId: "api-id", apiKey: "api-key" },
      now: () => 1_700_000_000_000,
      newToken: () => "tokfixed01",
      sleep,
    });

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).resolves.toEqual([{ id: "p1", name: "Proj" }]);
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(calls()).toBe(2);
  });

  it("does not retry a POST after rate limiting and blocks later customer calls during cooldown", async () => {
    const { http, calls } = sequentialHttp({
      status: 429,
      headers: { "retry-after": "30" },
      body: JSON.stringify({ error: "Too many requests" }),
    });
    let nowMs = 1_700_000_000_000;
    const client = createCloudShareClient({
      http,
      endpoints,
      tokenProvider: stubTokenProvider,
      customerId: "customer-helios",
      cooldownStore: createCooldownStore(),
      v3: { apiId: "api-id", apiKey: "api-key" },
      now: () => nowMs,
      newToken: () => "tokfixed01",
    });

    await expect(
      client.requestV4({
        method: "POST",
        path: "/trainings",
        body: { Name: "Exam" },
        schema: z.object({ id: z.string() }),
      }),
    ).rejects.toBeInstanceOf(CloudShareRateLimitError);

    nowMs += 15_000;

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      status: 429,
      classification: "rate_limit",
      context: expect.objectContaining({
        cooldownActive: true,
        retryAfterSeconds: 15,
        responseHeaders: { "retry-after": "30" },
        responseBody: { error: "Too many requests" },
      }),
    });

    expect(calls()).toBe(1);
  });

  it("activates customer cooldown when v4 token acquisition is rate-limited", async () => {
    const send = vi.fn(async () => ok([{ id: "p1", name: "Proj" }]));
    const getToken = vi.fn(async () => {
      throw new CloudShareRateLimitError("token throttled", 429, "rate_limit", {
        responseHeaders: { "retry-after": "20" },
        rateLimitHeaders: { "retry-after": "20" },
        retryAfterSeconds: 20,
      });
    });
    const cooldownStore = createCooldownStore();
    const client = createCloudShareClient({
      http: { send },
      endpoints,
      tokenProvider: {
        getToken,
      },
      customerId: "customer-helios",
      cooldownStore,
      v3: { apiId: "api-id", apiKey: "api-key" },
      now: () => 1_700_000_000_000,
      newToken: () => "tokfixed01",
    });

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toBeInstanceOf(CloudShareRateLimitError);

    await expect(
      client.requestV4({ method: "GET", path: "/projects", schema: projectsSchema }),
    ).rejects.toMatchObject({
      name: "CloudShareRateLimitError",
      context: expect.objectContaining({ cooldownActive: true }),
    });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
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
