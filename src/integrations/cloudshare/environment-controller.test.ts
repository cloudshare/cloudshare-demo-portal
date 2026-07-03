import { describe, it, expect, vi } from "vitest";
import { createCloudShareEnvironmentController } from "./environment-controller";
import type { CloudShareClient } from "./client";

function mockClient(over: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV4: vi.fn().mockResolvedValue({}),
    requestV3: vi.fn(),
    requestV3Text: vi.fn().mockResolvedValue(""),
    requestV3TextDetailed: vi.fn().mockResolvedValue({
      data: "",
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
      },
      response: {
        status: 200,
        body: "",
      },
    }),
    ...over,
  } as CloudShareClient;
}

describe("createCloudShareEnvironmentController", () => {
  it("issues a PUT to the documented v3 suspend action endpoint for the given CloudShare envId", async () => {
    const requestV3TextDetailed = vi.fn().mockResolvedValue({
      data: "",
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
      },
      response: {
        status: 200,
        body: "",
      },
    });
    const controller = createCloudShareEnvironmentController(mockClient({ requestV3TextDetailed }));

    await expect(controller.suspendEnvironment("ENVS2n38LTNdcC4sHsqnjRzg2")).resolves.toMatchObject({
      attemptedOperation: "suspend_environment",
      integrationSurface: "cloudshare.v3.env.action.suspend",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
      },
      response: {
        status: 200,
        body: "",
      },
      externalIds: {
        environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      },
    });

    expect(requestV3TextDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/suspend",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
  });

  it("issues a PUT to the documented v3 resume action endpoint for the given CloudShare envId", async () => {
    const requestV3TextDetailed = vi.fn().mockResolvedValue({
      data: "",
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/resume",
      },
      response: {
        status: 200,
        body: "",
      },
    });
    const controller = createCloudShareEnvironmentController(mockClient({ requestV3TextDetailed }));

    await expect(controller.resumeEnvironment("ENVS2n38LTNdcC4sHsqnjRzg2")).resolves.toMatchObject({
      attemptedOperation: "resume_environment",
      integrationSurface: "cloudshare.v3.env.action.resume",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/resume",
      },
      response: {
        status: 200,
        body: "",
      },
      externalIds: {
        environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      },
    });

    expect(requestV3TextDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/resume",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
  });

  it("issues a PUT to the undocumented v3 archive action endpoint for the given CloudShare envId", async () => {
    const requestV3TextDetailed = vi.fn().mockResolvedValue({
      data: "",
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/archive",
      },
      response: {
        status: 200,
        body: "",
      },
    });
    const controller = createCloudShareEnvironmentController(mockClient({ requestV3TextDetailed }));

    await expect(controller.archiveEnvironment("ENVS2n38LTNdcC4sHsqnjRzg2")).resolves.toMatchObject({
      attemptedOperation: "archive_environment",
      integrationSurface: "cloudshare.v3.env.action.archive",
      request: {
        method: "PUT",
        path: "/api/v3/envs/actions/archive",
      },
      response: {
        status: 200,
        body: "",
      },
      externalIds: {
        environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      },
    });

    expect(requestV3TextDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/archive",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
  });

  it("propagates CloudShare errors from suspendEnvironment", async () => {
    const err = new Error("CloudShare 502");
    const controller = createCloudShareEnvironmentController(
      mockClient({
        requestV3TextDetailed: vi.fn().mockRejectedValue(err),
        requestV3Text: vi.fn().mockRejectedValue(err),
      }),
    );

    await expect(controller.suspendEnvironment("env-1")).rejects.toThrow("CloudShare 502");
  });

  it("propagates CloudShare errors from resumeEnvironment", async () => {
    const err = new Error("CloudShare 503");
    const controller = createCloudShareEnvironmentController(
      mockClient({
        requestV3TextDetailed: vi.fn().mockRejectedValue(err),
        requestV3Text: vi.fn().mockRejectedValue(err),
      }),
    );

    await expect(controller.resumeEnvironment("env-1")).rejects.toThrow("CloudShare 503");
  });
});
