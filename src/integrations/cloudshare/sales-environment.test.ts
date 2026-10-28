import { describe, expect, it, vi } from "vitest";
import { cloudShareV3SalesEnvironmentStatusCodeSchema, createCloudShareSalesEnvironmentSource } from "./sales-environment";

describe("CloudShare Sales Environment observation", () => {
  it("accepts only the documented numeric Environment status namespace", () => {
    expect([2, 3, 4, 5, 7, 8, 9].map((value) => cloudShareV3SalesEnvironmentStatusCodeSchema.parse(value))).toEqual([2, 3, 4, 5, 7, 8, 9]);
    expect(() => cloudShareV3SalesEnvironmentStatusCodeSchema.parse(6)).toThrow();
  });
  it("issues the documented v4 Extend action with the exact opaque ID and no duration override", async () => {
    const requestV4Detailed = vi.fn().mockResolvedValue({
      data: "",
      host: "api.accelerate.cloudshare.com",
      integrationSurface: "cloudshare.v4",
      request: {
        method: "POST" as const,
        path: "/v4/environments/opaque-b/extend",
      },
      response: {
        status: 204,
        body: "",
      },
    });
    const source = createCloudShareSalesEnvironmentSource({
      requestV3Detailed: vi.fn(),
      requestV3: vi.fn(),
      requestV4Detailed,
      requestV3Text: vi.fn(),
    } as never);

    await expect(source.extendById?.("opaque-b")).resolves.toMatchObject({
      environmentId: "opaque-b",
      exchange: {
        request: {
          method: "POST",
          path: "/v4/environments/opaque-b/extend",
        },
        response: {
          status: 204,
          body: "",
        },
      },
    });

    expect(requestV4Detailed).toHaveBeenCalledWith({
      method: "POST",
      path: "/environments/opaque-b/extend",
      allowEmptyResponse: true,
      schema: expect.anything(),
    });
    expect(requestV4Detailed.mock.calls[0]?.[0]).not.toHaveProperty("body");
    expect(requestV4Detailed.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });
});
