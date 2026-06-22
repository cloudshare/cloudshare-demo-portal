import { describe, expect, it } from "vitest";
import {
  formatCandidateAttemptStatus,
  getCandidateLabPresentation,
} from "./candidate-lab-state";

describe("candidate lab state", () => {
  it("formats raw attempt statuses into human-readable labels", () => {
    expect(formatCandidateAttemptStatus("in_progress")).toBe("In progress");
    expect(formatCandidateAttemptStatus("completed")).toBe("Completed");
    expect(formatCandidateAttemptStatus("suspended")).toBe("Suspended");
  });

  it("returns a completed lab state that removes suspend/enter actions and offers score navigation", () => {
    expect(
      getCandidateLabPresentation({
        status: "completed",
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        scheduledFor: "2026-06-18T09:00:00.000Z",
      }),
    ).toMatchObject({
      heading: "Helios Guided Journey",
      statusLabel: "Completed",
      notice: null,
      showEnter: false,
      showSuspend: false,
      showResume: false,
      showCandidateHomeLink: true,
      showScoreLink: true,
      supportDetail: "Exam attempt: attempt-1",
      scheduledForLabel: `Scheduled for ${new Date("2026-06-18T09:00:00.000Z").toLocaleString()}`,
    });
  });
});
