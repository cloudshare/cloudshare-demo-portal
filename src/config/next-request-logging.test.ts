import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next request logging", () => {
  it("excludes only bearer capability paths from Next development request logs", () => {
    expect(nextConfig.logging).not.toBe(false);
    const incoming = nextConfig.logging && nextConfig.logging.incomingRequests;
    expect(incoming).not.toBe(false);
    const ignore = incoming && typeof incoming === "object" ? incoming.ignore ?? [] : [];
    expect(ignore.some((pattern) => pattern.test("/sales/launch/opaque-capability"))).toBe(true);
    expect(ignore.some((pattern) => pattern.test("/sales/launch/opaque-capability?source=email"))).toBe(true);
    expect(ignore.some((pattern) => pattern.test("/api/sales/enablement-sessions"))).toBe(false);
  });
});
