import { describe, expect, it, vi } from "vitest";
import type {
  CloudShareClient,
  CloudShareDetailedResult,
  V4RequestSpec,
} from "./client";
import { CloudShareRateLimitError, CloudShareRequestError } from "./errors";
import {
  inspectCloudShareEnvironmentLease,
  inspectCloudShareTrainingLease,
} from "./external-lease";

function makeClient(overrides: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV3: vi.fn(),
    requestV3Text: vi.fn(),
    requestV4: vi.fn(),
    requestV3Detailed: vi.fn(),
    requestV4Detailed: vi.fn(),
    requestV3TextDetailed: vi.fn(),
    ...overrides,
  } as unknown as CloudShareClient;
}

describe("external lease inspection", () => {
  it("preserves 404 environment evidence as an expired external lease", async () => {
    const client = makeClient({
      requestV3Detailed: vi.fn(async () => {
        throw new CloudShareRequestError("not found", 404, {
          method: "GET",
          host: "use.cloudshare.com",
          path: "/v3/envs/ENVS-expired-1",
          integrationSurface: "cloudshare.v3.env.get",
          requestHeaders: { authorization: "[REDACTED]" },
          responseHeaders: { "content-type": "application/json" },
          responseBody: { message: "Environment not found", code: "0x40402" },
        });
      }),
    });

    const lease = await inspectCloudShareEnvironmentLease(client, "ENVS-expired-1");

    expect(lease).toMatchObject({
      kind: "expired",
      target: "environment",
      attemptedOperation: "get_environment",
      integrationSurface: "cloudshare.v3.env.get",
      method: "GET",
      path: "/v3/envs/ENVS-expired-1",
      responseStatus: 404,
      environmentStatus: "deleted",
      reason: "not_found",
      request: {
        method: "GET",
        path: "/v3/envs/ENVS-expired-1",
      },
      response: {
        status: 404,
        headers: { "content-type": "application/json" },
        body: { message: "Environment not found", code: "0x40402" },
      },
    });
  });

  it("treats a passed training End as an expired external lease when no environment id is correlated", async () => {
    const client = makeClient({
      requestV4Detailed: vi.fn().mockImplementation(
        async <T>(spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>> => ({
          data: {
            id: "EXtraining-1",
            end: "2026-06-15T15:59:00.000Z",
            status: "active",
          } as T,
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training.get",
          request: {
            method: spec.method,
            path: `/v4${spec.path}`,
          },
          response: {
            status: 200,
            body: {
              id: "EXtraining-1",
              end: "2026-06-15T15:59:00.000Z",
              status: "active",
            },
          },
        }),
      ),
    });

    const lease = await inspectCloudShareTrainingLease(client, "EXtraining-1", {
      now: new Date("2026-06-15T16:00:00.000Z"),
    });

    expect(lease).toMatchObject({
      kind: "expired",
      target: "training",
      attemptedOperation: "get_training",
      integrationSurface: "cloudshare.v4.training.get",
      method: "GET",
      path: "/v4/trainings/EXtraining-1",
      leaseEndsAt: "2026-06-15T15:59:00.000Z",
      reason: "end_elapsed",
      request: {
        method: "GET",
        path: "/v4/trainings/EXtraining-1",
      },
      response: {
        status: 200,
      },
    });
  });

  it("treats a live-shaped ended training readback as an expired external lease", async () => {
    const client = makeClient({
      requestV4Detailed: vi.fn().mockImplementation(
        async <T>(spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>> => ({
          data: {
            id: "EXVUAmxA5jgVfM29E2D4cTNA2",
            start: "2026-06-30T15:48:00",
            end: "2026-06-30T15:58:00",
            status: "ended",
          } as T,
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training.get",
          request: {
            method: spec.method,
            path: `/v4${spec.path}`,
          },
          response: {
            status: 200,
            body: {
              id: "EXVUAmxA5jgVfM29E2D4cTNA2",
              start: "2026-06-30T15:48:00",
              end: "2026-06-30T15:58:00",
              status: "ended",
            },
          },
        }),
      ),
    });

    const lease = await inspectCloudShareTrainingLease(
      client,
      "EXVUAmxA5jgVfM29E2D4cTNA2",
      {
        now: new Date("2026-07-02T12:00:00.000Z"),
      },
    );

    expect(lease).toMatchObject({
      kind: "expired",
      target: "training",
      attemptedOperation: "get_training",
      integrationSurface: "cloudshare.v4.training.get",
      method: "GET",
      path: "/v4/trainings/EXVUAmxA5jgVfM29E2D4cTNA2",
      environmentStatus: "ended",
      leaseEndsAt: "2026-06-30T15:58:00",
      reason: "status_terminal",
      request: {
        method: "GET",
        path: "/v4/trainings/EXVUAmxA5jgVfM29E2D4cTNA2",
      },
      response: {
        status: 200,
        body: {
          id: "EXVUAmxA5jgVfM29E2D4cTNA2",
          start: "2026-06-30T15:48:00",
          end: "2026-06-30T15:58:00",
          status: "ended",
        },
      },
    });
  });

  it("preserves non-404 environment inspection failures as actionable diagnostics evidence", async () => {
    const client = makeClient({
      requestV3Detailed: vi.fn(async () => {
        throw new CloudShareRequestError("forbidden", 403, {
          method: "GET",
          host: "use.cloudshare.com",
          path: "/v3/envs/ENVS-live-1",
          integrationSurface: "cloudshare.v3.env.get",
          requestHeaders: { authorization: "[REDACTED]" },
          responseHeaders: { "content-type": "application/json" },
          responseBody: { message: "Forbidden" },
        });
      }),
    });

    const lease = await inspectCloudShareEnvironmentLease(client, "ENVS-live-1");

    expect(lease).toMatchObject({
      kind: "unknown",
      target: "environment",
      attemptedOperation: "get_environment",
      integrationSurface: "cloudshare.v3.env.get",
      method: "GET",
      path: "/v3/envs/ENVS-live-1",
      failureMode: "http_status",
      responseStatus: 403,
      request: {
        method: "GET",
        path: "/v3/envs/ENVS-live-1",
      },
      response: {
        status: 403,
        body: { message: "Forbidden" },
      },
    });
  });

  it("preserves cached prior 429 evidence when an environment read is blocked by cooldown", async () => {
    const client = makeClient({
      requestV3Detailed: vi.fn(async () => {
        throw new CloudShareRateLimitError("requests are cooling down", 429, "rate_limit", {
          method: "GET",
          host: "use.cloudshare.com",
          path: "/v3/envs/ENVS-live-1",
          integrationSurface: "cloudshare.v3.env.get",
          cooldownActive: true,
          responseHeaders: { "retry-after": "30" },
          responseBody: { error: "Too many requests" },
        });
      }),
    });

    const lease = await inspectCloudShareEnvironmentLease(client, "ENVS-live-1");

    expect(lease).toMatchObject({
      kind: "unknown",
      failureMode: "rate_limit",
      responseStatus: 429,
      responseEvidence: "cached_prior",
      response: {
        status: 429,
        headers: { "retry-after": "30" },
        body: { error: "Too many requests" },
      },
    });
  });

  it("classifies a rehydrated rate-limit error with its cached prior evidence", async () => {
    const client = makeClient({
      requestV3Detailed: vi.fn(async () => {
        throw {
          name: "CloudShareRateLimitError",
          message: "requests are cooling down",
          classification: "rate_limit",
          context: {
            status: 429,
            method: "GET",
            host: "use.cloudshare.com",
            path: "/v3/envs/ENVS-live-1",
            integrationSurface: "cloudshare.v3.env.get",
            cooldownActive: true,
            requestHeaders: {
              authorization: "Bearer rehydrated-request-secret",
              cookie: "cloudshare-session=rehydrated-request-secret",
            },
            requestQuery: {
              token: "rehydrated-request-secret",
              returnUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=rehydrated-request-secret",
            },
            requestBody: {
              bearerHeader: "Bearer rehydrated-request-secret",
              loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=rehydrated-request-secret",
            },
            responseHeaders: {
              "retry-after": "30",
              authorization: "Bearer rehydrated-secret",
              "set-cookie": "cloudshare-session=rehydrated-secret",
            },
            responseBody: {
              error: "Too many requests",
              bearerHeader: "Bearer rehydrated-secret",
              loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=rehydrated-secret",
            },
          },
        };
      }),
    });

    const lease = await inspectCloudShareEnvironmentLease(client, "ENVS-live-1");

    expect(lease).toMatchObject({
      kind: "unknown",
      failureMode: "rate_limit",
      responseStatus: 429,
      responseEvidence: "cached_prior",
      request: {
        headers: {
          authorization: "[REDACTED]",
          cookie: "[REDACTED]",
        },
        query: {
          token: "[REDACTED]",
          returnUrl: "[REDACTED]",
        },
        body: {
          bearerHeader: "[REDACTED]",
          loginUrl: "[REDACTED]",
        },
      },
      response: {
        status: 429,
        headers: {
          authorization: "[REDACTED]",
          "set-cookie": "[REDACTED]",
        },
        body: {
          bearerHeader: "[REDACTED]",
          loginUrl: "[REDACTED]",
        },
      },
    });
    expect(JSON.stringify(lease)).not.toContain("rehydrated-secret");
    expect(JSON.stringify(lease)).not.toContain("rehydrated-request-secret");
  });
});
