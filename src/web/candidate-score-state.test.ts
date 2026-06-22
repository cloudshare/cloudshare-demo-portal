import { describe, expect, it } from "vitest";
import { getCandidateScorePresentation } from "./candidate-score-state";

describe("candidate score state", () => {
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
      scheduledForLabel: `Scheduled for ${new Date("2026-06-18T09:00:00.000Z").toLocaleString()}`,
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
