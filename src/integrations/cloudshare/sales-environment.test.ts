import { describe, expect, it, vi } from "vitest";
import { cloudShareV3SalesEnvironmentStatusCodeSchema, createCloudShareSalesEnvironmentSource, SalesEnvironmentResolutionError } from "./sales-environment";

const detailed = (data: unknown, path: string) => ({ data, host: "use.cloudshare.com", integrationSurface: "cloudshare.v3", request: { method: "GET" as const, path }, response: { status: 200, body: data } });

describe("CloudShare Sales Environment observation", () => {
  it("accepts only the documented numeric Environment status namespace", () => {
    expect([2, 3, 4, 5, 7, 8, 9].map((value) => cloudShareV3SalesEnvironmentStatusCodeSchema.parse(value))).toEqual([2, 3, 4, 5, 7, 8, 9]);
    expect(() => cloudShareV3SalesEnvironmentStatusCodeSchema.parse(6)).toThrow();
  });
  it("resolves exactly one owner Environment in the Item project before reading numeric status", async () => {
    const requestV3Detailed = vi.fn()
      .mockResolvedValueOnce(detailed([{ id: "opaque-a", projectId: "other" }, { id: "opaque-b", projectId: "project-1" }], "/api/v3/envs"))
      .mockResolvedValueOnce(detailed({ statusCode: 3, expirationTime: "Tue, 01 Sep 2026 11:10:59 GMT" }, "/api/v3/envs/actions/getextended"));
    const source = createCloudShareSalesEnvironmentSource({ requestV3Detailed, requestV3: vi.fn() } as never);
    await expect(source.observe({ ownerEmail: "participant@example.test", projectId: "project-1" })).resolves.toMatchObject({ environmentId: "opaque-b", statusCode: 3, expirationTime: "Tue, 01 Sep 2026 11:10:59 GMT", exchanges: [{ request: { path: "/api/v3/envs" } }, { request: { path: "/api/v3/envs/actions/getextended" } }] });
    expect(requestV3Detailed).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "/envs", query: { ownerEmail: "participant@example.test", brief: "false" } }));
    expect(requestV3Detailed).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "/envs/actions/getextended", query: { envId: "opaque-b" } }));
  });

  it.each([[[]], [[{ id: "a", projectId: "project-1" }, { id: "b", projectId: "project-1" }]]])("fails closed unless the project match is unique", async (items) => {
    const source = createCloudShareSalesEnvironmentSource({ requestV3Detailed: vi.fn().mockResolvedValue(detailed(items, "/api/v3/envs")), requestV3: vi.fn() } as never);
    await expect(source.observe({ ownerEmail: "participant@example.test", projectId: "project-1" })).rejects.toBeInstanceOf(SalesEnvironmentResolutionError);
  });

  it("issues the documented v3 extend action with the canonical envId and no duration override", async () => {
    const requestV3TextDetailed = vi.fn().mockResolvedValue({
      data: "",
      host: "use.cloudshare.com",
      integrationSurface: "cloudshare.v3",
      request: {
        method: "PUT" as const,
        path: "/api/v3/envs/actions/extend",
        query: { envId: "opaque-b" },
      },
      response: {
        status: 200,
        body: "",
      },
    });
    const source = createCloudShareSalesEnvironmentSource({
      requestV3Detailed: vi.fn(),
      requestV3: vi.fn(),
      requestV3TextDetailed,
      requestV3Text: vi.fn(),
    } as never);

    await expect(source.extendById?.("opaque-b")).resolves.toMatchObject({
      environmentId: "opaque-b",
      exchange: {
        request: {
          method: "PUT",
          path: "/api/v3/envs/actions/extend",
          query: { envId: "opaque-b" },
        },
        response: {
          status: 200,
          body: "",
        },
      },
    });

    expect(requestV3TextDetailed).toHaveBeenCalledWith({
      method: "PUT",
      path: "/envs/actions/extend",
      query: { envId: "opaque-b" },
    });
    expect(requestV3TextDetailed.mock.calls[0]?.[0]).not.toHaveProperty("body");
    expect(requestV3TextDetailed.mock.calls[0]?.[0]?.query).not.toHaveProperty("duration");
  });
});
