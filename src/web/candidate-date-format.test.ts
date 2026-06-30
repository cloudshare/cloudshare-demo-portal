import { afterEach, describe, expect, it } from "vitest";
import {
  formatCandidateScheduledDateTime,
  formatCandidateScheduledForLabel,
  parseCandidateLocalDateTimeInput,
} from "./candidate-date-format";

describe("candidate scheduled date formatting", () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTimezone;
  });

  it("formats scheduled times with an ISO-style local date and time", () => {
    process.env.TZ = "Europe/London";

    expect(formatCandidateScheduledDateTime("2026-06-18T09:00:00.000Z")).toBe(
      "2026-06-18 10:00",
    );
    expect(formatCandidateScheduledForLabel("2026-06-18T09:00:00.000Z")).toBe(
      "Scheduled for 2026-06-18 10:00",
    );
  });

  it("uses local date/time getters instead of UTC ISO slicing", () => {
    process.env.TZ = "Europe/London";
    const localNineAmDuringBst = new Date(2026, 5, 18, 9, 0);

    expect(localNineAmDuringBst.toISOString()).toContain("08:00:00.000Z");
    expect(formatCandidateScheduledDateTime(localNineAmDuringBst.toISOString())).toBe(
      "2026-06-18 09:00",
    );
  });

  it("omits missing or invalid scheduled times", () => {
    expect(formatCandidateScheduledDateTime(null)).toBeNull();
    expect(formatCandidateScheduledDateTime("not-a-date")).toBeNull();
    expect(formatCandidateScheduledForLabel(null)).toBeNull();
    expect(formatCandidateScheduledForLabel("not-a-date")).toBeNull();
  });

  it("parses visible ISO-style local schedule input to the API timestamp", () => {
    process.env.TZ = "Europe/London";

    expect(parseCandidateLocalDateTimeInput("2026-06-18 09:00")).toBe(
      "2026-06-18T08:00:00.000Z",
    );
    expect(parseCandidateLocalDateTimeInput(" 2026-06-18 09:00 ")).toBe(
      "2026-06-18T08:00:00.000Z",
    );
  });

  it("rejects missing or invalid visible schedule input", () => {
    expect(parseCandidateLocalDateTimeInput("")).toBeNull();
    expect(parseCandidateLocalDateTimeInput("2026-06-18T09:00")).toBeNull();
    expect(parseCandidateLocalDateTimeInput("18/06/2026 09:00")).toBeNull();
    expect(parseCandidateLocalDateTimeInput("2026-02-30 09:00")).toBeNull();
    expect(parseCandidateLocalDateTimeInput("2026-06-18 24:00")).toBeNull();
    expect(parseCandidateLocalDateTimeInput("not-a-date")).toBeNull();
  });
});
