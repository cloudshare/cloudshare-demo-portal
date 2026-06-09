import { describe, it, expect, vi } from "vitest";
import { createCloudShareEnvironmentController } from "./environment-controller";
import type { CloudShareClient } from "./client";

function mockClient(over: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV4: vi.fn().mockResolvedValue({}),
    requestV3: vi.fn(),
    ...over,
  } as CloudShareClient;
}

describe("createCloudShareEnvironmentController", () => {
  it("issues a POST to the suspend action endpoint for the given environment", async () => {
    const requestV4 = vi.fn().mockResolvedValue({});
    const controller = createCloudShareEnvironmentController(mockClient({ requestV4 }));

    await controller.suspendEnvironment("env-42");

    expect(requestV4).toHaveBeenCalledOnce();
    const call = requestV4.mock.calls[0][0];
    expect(call.method).toBe("POST");
    expect(call.path).toContain("env-42");
    expect(call.path).toContain("suspend");
  });

  it("issues a POST to the resume action endpoint for the given environment", async () => {
    const requestV4 = vi.fn().mockResolvedValue({});
    const controller = createCloudShareEnvironmentController(mockClient({ requestV4 }));

    await controller.resumeEnvironment("env-42");

    expect(requestV4).toHaveBeenCalledOnce();
    const call = requestV4.mock.calls[0][0];
    expect(call.method).toBe("POST");
    expect(call.path).toContain("env-42");
    expect(call.path).toContain("resume");
  });

  it("propagates CloudShare errors from suspendEnvironment", async () => {
    const err = new Error("CloudShare 502");
    const controller = createCloudShareEnvironmentController(
      mockClient({ requestV4: vi.fn().mockRejectedValue(err) }),
    );

    await expect(controller.suspendEnvironment("env-1")).rejects.toThrow("CloudShare 502");
  });

  it("propagates CloudShare errors from resumeEnvironment", async () => {
    const err = new Error("CloudShare 503");
    const controller = createCloudShareEnvironmentController(
      mockClient({ requestV4: vi.fn().mockRejectedValue(err) }),
    );

    await expect(controller.resumeEnvironment("env-1")).rejects.toThrow("CloudShare 503");
  });
});
