import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next request logging", () => {
  it("does not write bearer capability paths to framework access logs", () => {
    expect(nextConfig.logging).not.toBe(false);
    expect(nextConfig.logging && nextConfig.logging.incomingRequests).toBe(false);
  });
});
