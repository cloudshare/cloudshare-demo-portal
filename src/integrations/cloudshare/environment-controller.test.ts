import { describe, it, expect, vi } from "vitest";
import { createCloudShareEnvironmentController } from "./environment-controller";
import type { CloudShareClient } from "./client";

function mockClient(over: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV4: vi.fn().mockResolvedValue({}),
    requestV3: vi.fn(),
    requestV3Text: vi.fn().mockResolvedValue(""),
    ...over,
  } as CloudShareClient;
}

describe("createCloudShareEnvironmentController", () => {
  it("issues a PUT to the documented v3 suspend action endpoint for the given CloudShare envId", async () => {
    const requestV3Text = vi.fn().mockResolvedValue("");
    const controller = createCloudShareEnvironmentController(mockClient({ requestV3Text }));

    await controller.suspendEnvironment("ENVS2n38LTNdcC4sHsqnjRzg2");

    expect(requestV3Text).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/suspend",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
  });

  it("issues a PUT to the documented v3 resume action endpoint for the given CloudShare envId", async () => {
    const requestV3Text = vi.fn().mockResolvedValue("");
    const controller = createCloudShareEnvironmentController(mockClient({ requestV3Text }));

    await controller.resumeEnvironment("ENVS2n38LTNdcC4sHsqnjRzg2");

    expect(requestV3Text).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/resume",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
  });

  it("propagates CloudShare errors from suspendEnvironment", async () => {
    const err = new Error("CloudShare 502");
    const controller = createCloudShareEnvironmentController(
      mockClient({ requestV3Text: vi.fn().mockRejectedValue(err) }),
    );

    await expect(controller.suspendEnvironment("env-1")).rejects.toThrow("CloudShare 502");
  });

  it("propagates CloudShare errors from resumeEnvironment", async () => {
    const err = new Error("CloudShare 503");
    const controller = createCloudShareEnvironmentController(
      mockClient({ requestV3Text: vi.fn().mockRejectedValue(err) }),
    );

    await expect(controller.resumeEnvironment("env-1")).rejects.toThrow("CloudShare 503");
  });
});
