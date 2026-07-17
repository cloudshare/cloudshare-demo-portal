import { describe, expect, it } from "vitest";
import { WINDOWS_TO_IANA_MAP } from "windows-iana";
import { addCloudShareWallClockMinutes, formatCloudShareWallClock, isValidCloudShareWallClock } from "./cloudshare-wall-clock";

describe("CloudShare wall-clock timing", () => {
  it("adds a Policy lease in the selected CloudShare timezone across spring DST", () => {
    expect(addCloudShareWallClockMinutes("2026-03-08T01:30", "Mountain Standard Time", 120)).toBe("2026-03-08T04:30");
  });

  it("rejects skipped and ambiguous local wall-clock values instead of applying the browser timezone", () => {
    expect(isValidCloudShareWallClock("2026-03-08T02:30", "Mountain Standard Time")).toBe(false);
    expect(isValidCloudShareWallClock("2026-11-01T01:30", "Mountain Standard Time")).toBe(false);
  });

  it("renders every Windows timezone from the pinned CLDR catalogue and rejects unknown IDs", () => {
    const windowsIds = [...new Set(WINDOWS_TO_IANA_MAP.map((entry) => entry.windowsName))];
    expect(windowsIds).toHaveLength(139);
    for (const timeZone of windowsIds) {
      expect(formatCloudShareWallClock(new Date("2026-01-15T12:00:00.000Z"), timeZone), timeZone).not.toBeNull();
    }
    expect(formatCloudShareWallClock(new Date("2026-01-15T12:00:00.000Z"), "Unknown CloudShare Zone")).toBeNull();
  });
});
