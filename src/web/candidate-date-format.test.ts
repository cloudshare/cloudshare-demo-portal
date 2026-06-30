import { describe, expect, it } from "vitest";
import {
  formatCandidateScheduledDateTime,
  formatCandidateScheduledForLabel,
} from "./candidate-date-format";

describe("candidate scheduled date formatting", () => {
  it("formats scheduled times with an ISO-style date and explicit UTC time", () => {
    expect(formatCandidateScheduledDateTime("2026-06-18T09:00:00.000Z")).toBe(
      "2026-06-18 09:00 UTC",
    );
    expect(formatCandidateScheduledForLabel("2026-06-18T09:00:00.000Z")).toBe(
      "Scheduled for 2026-06-18 09:00 UTC",
    );
  });

  it("omits missing or invalid scheduled times", () => {
    expect(formatCandidateScheduledDateTime(null)).toBeNull();
    expect(formatCandidateScheduledDateTime("not-a-date")).toBeNull();
    expect(formatCandidateScheduledForLabel(null)).toBeNull();
    expect(formatCandidateScheduledForLabel("not-a-date")).toBeNull();
  });
});
