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
  it("polls v3 GET environment and maps the status", async () => {
    const requestV3 = vi.fn().mockResolvedValue({ status: "Ready" });
    const source = createCloudShareEnvironmentSource(client({ requestV3 }));

    const snapshot = await source.getEnvironmentState("env-1");

    expect(snapshot).toEqual({ environmentExternalId: "env-1", status: "running" });
    expect(requestV3).toHaveBeenCalledOnce();
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
