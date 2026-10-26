import { describe, expect, it, vi } from "vitest";
import { cloudShareV3SalesEnvironmentStatusCodeSchema, createCloudShareSalesEnvironmentSource } from "./sales-environment";

describe("CloudShare Sales Environment observation", () => {
  it("accepts only the documented numeric Environment status namespace", () => {
    expect([2, 3, 4, 5, 7, 8, 9].map((value) => cloudShareV3SalesEnvironmentStatusCodeSchema.parse(value))).toEqual([2, 3, 4, 5, 7, 8, 9]);
    expect(() => cloudShareV3SalesEnvironmentStatusCodeSchema.parse(6)).toThrow();
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
