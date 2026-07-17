import { describe, expect, it, vi } from "vitest";
import { createCloudShareTimezoneSource } from "./timezones";

describe("CloudShare timezones adapter", () => {
  it("uses only the documented v3 GET /timezones contract", async () => {
    const requestV3 = vi.fn().mockResolvedValue([{ id: "UTC", displayName: "UTC" }]);
    const source = createCloudShareTimezoneSource({ requestV3, requestV4: vi.fn(), requestV3Text: vi.fn() });
    await expect(source.list()).resolves.toMatchObject({ timezones: [{ id: "UTC", name: "UTC" }] });
    expect(requestV3).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/timezones" }));
  });
});
