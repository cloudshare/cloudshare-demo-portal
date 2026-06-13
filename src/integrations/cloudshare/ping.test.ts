import { describe, expect, it } from "vitest";
import { pingCloudShareV3 } from "./ping";
import { CloudShareResponseError } from "./errors";
import type { CloudShareClient } from "./client";

describe("pingCloudShareV3", () => {
  it("accepts a pong response", async () => {
    const client: CloudShareClient = {
      requestV3Text: async () => "pong",
      requestV3: async () => {
        throw new Error("not used");
      },
      requestV4: async () => {
        throw new Error("not used");
      },
    };

    await expect(pingCloudShareV3(client)).resolves.toBe("pong");
  });

  it("rejects an unexpected response body", async () => {
    const client: CloudShareClient = {
      requestV3Text: async () => "nope",
      requestV3: async () => {
        throw new Error("not used");
      },
      requestV4: async () => {
        throw new Error("not used");
      },
    };

    await expect(pingCloudShareV3(client)).rejects.toBeInstanceOf(CloudShareResponseError);
  });
});
