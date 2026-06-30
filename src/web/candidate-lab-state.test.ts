import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatCandidateAttemptStatus,
  getCandidateLabPresentation,
  type CandidateLabSummaryItem,
} from "./candidate-lab-state";

describe("candidate lab state", () => {
  const originalTimezone = process.env.TZ;
  const scheduledFor = "2026-06-18T09:00:00.000Z";
  const scheduledForValue = "2026-06-18 10:00";
  const scheduledForLabel = `Scheduled for ${scheduledForValue}`;

  beforeAll(() => {
    process.env.TZ = "Europe/London";
  });

  afterAll(() => {
    process.env.TZ = originalTimezone;
  });

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
        summaryItems: expect.arrayContaining<CandidateLabSummaryItem>([
          { label: "ExamAttempt ID", value: "attempt-1" },
          { label: "Status", value: formatCandidateAttemptStatus(status) },
          { label: "Time limit", value: "60 minute limit" },
          { label: "Scheduled for", value: scheduledForValue },
        ]),
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
      summaryItems: expect.arrayContaining<CandidateLabSummaryItem>([
        { label: "Status", value: "Completed" },
      ]),
    });
  });

  it("omits the scheduled summary item when the attempt has no valid scheduled time", () => {
    expect(
      getCandidateLabPresentation({
        status: "ready",
        examAttemptId: "attempt-2",
        examTitle: "Cold-start Exam",
        timeLimitMinutes: 45,
        scheduledFor: null,
      }).summaryItems,
    ).toEqual([
      { label: "ExamAttempt ID", value: "attempt-2" },
      { label: "Status", value: "Ready" },
      { label: "Time limit", value: "45 minute limit" },
    ]);
  });

  it("keeps invalid scheduled timestamps out of the readable summary", () => {
    expect(
      getCandidateLabPresentation({
        status: "ready",
        examAttemptId: "attempt-3",
        examTitle: "Recovery Exam",
        timeLimitMinutes: 30,
        scheduledFor: "not-a-date",
      }).summaryItems,
    ).toEqual([
      { label: "ExamAttempt ID", value: "attempt-3" },
      { label: "Status", value: "Ready" },
      { label: "Time limit", value: "30 minute limit" },
    ]);
  });

  it("describes the next action for each launcher-facing attempt status without changing available actions", () => {
    expect(
      getCandidateLabPresentation({
        status: "ready",
        examAttemptId: "attempt-4",
        examTitle: "Launch Exam",
        timeLimitMinutes: 60,
        scheduledFor,
      }),
    ).toMatchObject({
      actionTitle: "Ready to enter your exam",
      actionDetail: "Use Enter exam to open your CloudShare lab in a new window.",
    });

    expect(
      getCandidateLabPresentation({
        status: "in_progress",
        examAttemptId: "attempt-5",
        examTitle: "Resume Exam",
        timeLimitMinutes: 60,
        scheduledFor,
      }),
    ).toMatchObject({
      actionTitle: "Your exam is currently running",
      actionDetail: "Keep the lab window open while you work, or use Suspend lab before stepping away.",
    });

    expect(
      getCandidateLabPresentation({
        status: "suspended",
        examAttemptId: "attempt-6",
        examTitle: "Paused Exam",
        timeLimitMinutes: 60,
        scheduledFor,
      }),
    ).toMatchObject({
      actionTitle: "Your lab is paused",
      actionDetail: "Use Resume exam when you are ready to continue with the same ExamAttempt.",
    });

    expect(
      getCandidateLabPresentation({
        status: "completed",
        examAttemptId: "attempt-7",
        examTitle: "Finished Exam",
        timeLimitMinutes: 60,
        scheduledFor,
      }),
    ).toMatchObject({
      actionTitle: "This ExamAttempt is complete",
      actionDetail: "Your lab is no longer accepting launch or resume actions.",
    });
  });
});
