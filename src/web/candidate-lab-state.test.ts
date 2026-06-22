import { describe, expect, it } from "vitest";
import {
  formatCandidateAttemptStatus,
  getCandidateLabPresentation,
} from "./candidate-lab-state";

describe("candidate lab state", () => {
  const scheduledFor = "2026-06-18T09:00:00.000Z";
  const scheduledForLabel = `Scheduled for ${new Date(scheduledFor).toLocaleString()}`;

  it("formats raw attempt statuses into human-readable labels", () => {
    expect(formatCandidateAttemptStatus("in_progress")).toBe("In progress");
    expect(formatCandidateAttemptStatus("completed")).toBe("Completed");
    expect(formatCandidateAttemptStatus("suspended")).toBe("Suspended");
  });

  it.each([
    {
      status: "ready" as const,
      showEnter: true,
      showSuspend: false,
      showResume: false,
    },
    {
      status: "in_progress" as const,
      showEnter: true,
      showSuspend: true,
      showResume: false,
    },
    {
      status: "suspended" as const,
      showEnter: false,
      showSuspend: false,
      showResume: true,
    },
  ])(
    "includes the scheduled label for $status enter/resume presentation without changing action flags",
    ({ status, showEnter, showSuspend, showResume }) => {
      expect(
        getCandidateLabPresentation({
          status,
          examAttemptId: "attempt-1",
          examTitle: "Helios Guided Journey",
          timeLimitMinutes: 60,
          scheduledFor,
        }),
      ).toMatchObject({
        heading: "Helios Guided Journey",
        statusLabel: formatCandidateAttemptStatus(status),
        showEnter,
        showSuspend,
        showResume,
        showCandidateHomeLink: true,
        showScoreLink: false,
        supportDetail: "Exam attempt: attempt-1",
        scheduledForLabel,
      });
    },
  );

  it("returns a completed lab state that removes suspend/enter actions and offers score navigation", () => {
    expect(
      getCandidateLabPresentation({
        status: "completed",
        examAttemptId: "attempt-1",
        examTitle: "Helios Guided Journey",
        timeLimitMinutes: 60,
        scheduledFor,
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
      scheduledForLabel,
    });
  });
});
