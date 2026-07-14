import { describe, expect, it } from "vitest";
import { addCloudShareWallClockMinutes, isValidCloudShareWallClock } from "./cloudshare-wall-clock";

describe("CloudShare wall-clock timing", () => {
  it("adds a Policy lease in the selected CloudShare timezone across spring DST", () => {
    expect(addCloudShareWallClockMinutes("2026-03-08T01:30", "Mountain Standard Time", 120)).toBe("2026-03-08T04:30");
  });

  it("rejects skipped and ambiguous local wall-clock values instead of applying the browser timezone", () => {
    expect(isValidCloudShareWallClock("2026-03-08T02:30", "Mountain Standard Time")).toBe(false);
    expect(isValidCloudShareWallClock("2026-11-01T01:30", "Mountain Standard Time")).toBe(false);
  });
});
