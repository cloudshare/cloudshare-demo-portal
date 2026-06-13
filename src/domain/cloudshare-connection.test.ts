import { describe, expect, it, vi } from "vitest";
import {
  CloudShareConnectionTestError,
  MissingCloudShareConnectionError,
  saveCloudShareConnection,
  testCloudShareConnection,
  type CloudShareConnectionRepository,
} from "./cloudshare-connection";
import { CloudShareRequestError } from "@/integrations/cloudshare";
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

describe("saveCloudShareConnection", () => {
  it("delegates persistence to the repository", async () => {
    const repo = makeConnectionRepo();
    await expect(
      saveCloudShareConnection(repo, {
        customerId: "customer-helios",
        apiId: "api-id",
        apiKey: "api-key",
        webhookSecret: "whsec",
      }),
    ).resolves.toMatchObject({ customerId: "customer-helios" });
  });
});

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
    ).rejects.toBeInstanceOf(CloudShareConnectionTestError);
  });
});
