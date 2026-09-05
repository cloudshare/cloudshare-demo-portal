import { describe, expect, it, vi } from "vitest";
import { composeCloudShareObservers } from "./index";

describe("composeCloudShareObservers", () => {
  it("runs both synchronous observers when either one throws", async () => {
    const first = vi.fn(() => { throw new Error("first failed"); });
    const second = vi.fn(() => { throw new Error("second failed"); });

    await expect(composeCloudShareObservers(first, second)({ operation: "read" })).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
