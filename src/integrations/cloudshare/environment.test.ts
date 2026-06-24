import { describe, it, expect, vi } from "vitest";
import {
  createCloudShareEnvironmentSource,
  mapCloudShareEnvironmentStatus,
} from "./environment";
import { CloudShareRequestError } from "./errors";
import type { CloudShareClient } from "./client";

function client(over: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV4: vi.fn(),
    requestV3: vi.fn(),
    ...over,
  } as CloudShareClient;
}

describe("mapCloudShareEnvironmentStatus", () => {
  it("maps known CloudShare statuses onto the domain vocabulary (case-insensitive)", () => {
    expect(mapCloudShareEnvironmentStatus("Ready")).toBe("running");
    expect(mapCloudShareEnvironmentStatus("RUNNING")).toBe("running");
    expect(mapCloudShareEnvironmentStatus("Suspended")).toBe("suspended");
    expect(mapCloudShareEnvironmentStatus("Stopped")).toBe("suspended");
    expect(mapCloudShareEnvironmentStatus("Preparing")).toBe("created");
    expect(mapCloudShareEnvironmentStatus("Archived")).toBe("archived");
    expect(mapCloudShareEnvironmentStatus("Deleted")).toBe("deleted");
  });

  it("falls back to 'unknown' for an unrecognised status", () => {
    expect(mapCloudShareEnvironmentStatus("Reticulating")).toBe("unknown");
  });
});

describe("createCloudShareEnvironmentSource", () => {
  it("polls the documented v3 env-by-id endpoint and maps envStatus", async () => {
    const requestV3 = vi.fn().mockResolvedValue({ envStatus: "Ready" });
    const requestV3Detailed = vi.fn().mockResolvedValue({
      data: { envStatus: "Ready" },
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: {
        method: "GET",
        path: "/api/v3/envs/ENVS2n38LTNdcC4sHsqnjRzg2",
        headers: {
          authorization: "cs_sha1 userapiid:api-id;timestamp:123;token:[REDACTED];hmac:[REDACTED]",
        },
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { envStatus: "Ready" },
      },
    });
    const source = createCloudShareEnvironmentSource(client({ requestV3, requestV3Detailed }));

    const snapshot = await source.getEnvironmentState("ENVS2n38LTNdcC4sHsqnjRzg2");

    expect(snapshot).toEqual({
      environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      status: "running",
      request: {
        method: "GET",
        path: "/api/v3/envs/ENVS2n38LTNdcC4sHsqnjRzg2",
        headers: {
          authorization: "cs_sha1 userapiid:api-id;timestamp:123;token:[REDACTED];hmac:[REDACTED]",
        },
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { envStatus: "Ready" },
      },
    });
    expect(requestV3Detailed).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/envs/ENVS2n38LTNdcC4sHsqnjRzg2",
      }),
    );
    expect(requestV3).not.toHaveBeenCalled();
  });

  it("returns null when CloudShare reports the environment does not exist (404)", async () => {
    const requestV3 = vi.fn().mockRejectedValue(
      new CloudShareRequestError("not found", 404, {}),
    );
    const source = createCloudShareEnvironmentSource(client({ requestV3 }));

    expect(await source.getEnvironmentState("ghost")).toBeNull();
  });

  it("propagates non-404 CloudShare errors (they are not 'no such environment')", async () => {
    const requestV3 = vi.fn().mockRejectedValue(
      new CloudShareRequestError("server error", 500, {}),
    );
    const source = createCloudShareEnvironmentSource(client({ requestV3 }));

    await expect(source.getEnvironmentState("env-1")).rejects.toBeInstanceOf(
      CloudShareRequestError,
    );
  });
});
