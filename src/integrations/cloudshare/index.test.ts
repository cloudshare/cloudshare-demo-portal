import { describe, expect, it, vi } from "vitest";
import { composeCloudShareObservers, composeCanonicalObserver } from "./index";

describe("composeCloudShareObservers", () => {
  it("runs both synchronous observers when either one throws", async () => {
    const first = vi.fn(() => { throw new Error("first failed"); });
    const second = vi.fn(() => { throw new Error("second failed"); });

    await expect(composeCloudShareObservers(first, second)({ operation: "read" })).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default recorder only when the canonical workflow recorder rejects", async () => {
    const canonical = vi.fn().mockRejectedValue(new Error("unavailable"));
    const fallback = vi.fn();
    await composeCanonicalObserver(canonical, fallback)({ operation: "request" });
    expect(canonical).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
