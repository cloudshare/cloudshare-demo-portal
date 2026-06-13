import { describe, expect, it, vi } from "vitest";
import {
  CloudShareConnectionTestError,
  MissingCloudShareConnectionError,
  testCloudShareConnection,
  type CloudShareConnectionRepository,
} from "./cloudshare-connection";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import type { CloudShareClient } from "@/integrations/cloudshare";

function makeConnectionRepo(connection = {
  customerId: "customer-helios",
  apiId: "api-id",
  apiKey: "api-key",
  webhookSecret: "whsec",
  connectedAt: new Date("2026-06-13T18:00:00.000Z"),
  verifiedAt: null,
}): CloudShareConnectionRepository {
  return {
    save: vi.fn(async (input) => ({ ...connection, ...input })),
    findByCustomerId: vi.fn(async () => connection),
    markVerified: vi.fn(async () => {}),
  };
}

describe("testCloudShareConnection", () => {
  it("pings CloudShare and marks the stored connection verified on success", async () => {
    const repo = makeConnectionRepo();
    const verifiedAt = new Date("2026-06-13T18:05:00.000Z");
    const cloudshare = {
      forConnection: (): CloudShareClient => ({
        requestV3Text: async () => "pong",
        requestV3: async () => {
          throw new Error("not used");
        },
        requestV4: async () => {
          throw new Error("not used");
        },
      }),
    };

    await expect(
      testCloudShareConnection(
        { connections: repo, cloudshare, now: () => verifiedAt },
        "customer-helios",
      ),
    ).resolves.toEqual({
      status: "connected",
      message: "pong",
      verifiedAt,
    });
    expect(repo.markVerified).toHaveBeenCalledWith("customer-helios", verifiedAt);
  });

  it("fails clearly when no connection has been stored yet", async () => {
    const repo: CloudShareConnectionRepository = {
      save: vi.fn(),
      findByCustomerId: vi.fn(async () => null),
      markVerified: vi.fn(),
    };

    await expect(
      testCloudShareConnection(
        { connections: repo, cloudshare: { forConnection: vi.fn() } },
        "customer-helios",
      ),
    ).rejects.toBeInstanceOf(MissingCloudShareConnectionError);
  });

  it("turns CloudShare auth failures into an actionable typed error", async () => {
    const repo = makeConnectionRepo();
    const cloudshare = {
      forConnection: (): CloudShareClient => ({
        requestV3Text: async () => {
          throw new CloudShareRequestError("401 unauthorized", 401);
        },
        requestV3: async () => {
          throw new Error("not used");
        },
        requestV4: async () => {
          throw new Error("not used");
        },
      }),
    };

    await expect(
      testCloudShareConnection(
        { connections: repo, cloudshare },
        "customer-helios",
      ),
    ).rejects.toMatchObject({
      name: "CloudShareConnectionTestError",
      message: "CloudShare returned 401 to the v3 ping. Check API ID and API key.",
      diagnostic: {
        operation: "test_connection",
        integrationSurface: "cloudshare.v3.ping",
        method: "GET",
        path: "/ping",
        failureMode: "http_status",
        responseStatus: 401,
      },
    });
  });

  it("distinguishes network reachability failures from credential failures", async () => {
    const repo = makeConnectionRepo();
    const cloudshare = {
      forConnection: (): CloudShareClient => ({
        requestV3Text: async () => {
          throw new CloudShareTransportError("socket timeout");
        },
        requestV3: async () => {
          throw new Error("not used");
        },
        requestV4: async () => {
          throw new Error("not used");
        },
      }),
    };

    await expect(
      testCloudShareConnection(
        { connections: repo, cloudshare },
        "customer-helios",
      ),
    ).rejects.toMatchObject({
      name: "CloudShareConnectionTestError",
      message: "CloudShare ping could not reach the server. Check network reachability.",
      diagnostic: {
        operation: "test_connection",
        integrationSurface: "cloudshare.v3.ping",
        method: "GET",
        path: "/ping",
        failureMode: "transport",
      },
    });
  });

  it("distinguishes malformed CloudShare responses from credential failures", async () => {
    const repo = makeConnectionRepo();
    const cloudshare = {
      forConnection: (): CloudShareClient => ({
        requestV3Text: async () => {
          throw new CloudShareResponseError("unexpected payload");
        },
        requestV3: async () => {
          throw new Error("not used");
        },
        requestV4: async () => {
          throw new Error("not used");
        },
      }),
    };

    await expect(
      testCloudShareConnection(
        { connections: repo, cloudshare },
        "customer-helios",
      ),
    ).rejects.toMatchObject({
      name: "CloudShareConnectionTestError",
      message: "CloudShare ping returned an unexpected response.",
      diagnostic: {
        operation: "test_connection",
        integrationSurface: "cloudshare.v3.ping",
        method: "GET",
        path: "/ping",
        failureMode: "unexpected_response",
      },
    });
  });
});
