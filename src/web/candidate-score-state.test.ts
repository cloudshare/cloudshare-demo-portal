import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCandidateScorePresentation } from "./candidate-score-state";

describe("candidate score state", () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/London";
  });

  afterAll(() => {
    process.env.TZ = originalTimezone;
  });

  it("formats the completed score page metadata with exam title and scheduled time", () => {
    expect(
      getCandidateScorePresentation({
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        scheduledFor: "2026-06-18T09:00:00.000Z",
      }),
    ).toEqual({
      heading: "Helios Guided Journey",
      supportDetail: "Exam attempt: attempt-1",
      scheduledForLabel: "Scheduled for 2026-06-18 10:00",
    });
  });

  it("omits the scheduled-time label when the attempt has no scheduled time", () => {
    expect(
      getCandidateScorePresentation({
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        scheduledFor: null,
      }),
    ).toEqual({
      heading: "Helios Guided Journey",
      supportDetail: "Exam attempt: attempt-1",
      scheduledForLabel: null,
    });
  });
});
