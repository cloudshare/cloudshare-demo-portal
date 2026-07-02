import { describe, expect, it, vi } from "vitest";
import type { CloudShareClient } from "./client";
import { CloudShareRequestError } from "./errors";
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
  };
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
      requestV4Detailed: vi.fn(async () => ({
        data: {
          id: "EXtraining-1",
          end: "2026-06-15T15:59:00.000Z",
          status: "active",
        },
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.get",
        request: {
          method: "GET",
          path: "/v4/trainings/EXtraining-1",
        },
        response: {
          status: 200,
          body: {
            id: "EXtraining-1",
            end: "2026-06-15T15:59:00.000Z",
            status: "active",
          },
        },
      })),
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
});
