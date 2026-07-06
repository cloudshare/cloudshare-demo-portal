import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COLD_START_WARNING_MESSAGE,
  MAX_ENTERABILITY_WAKE_UP_DELAY_MS,
  buildCandidateExamDurationLabels,
  buildCandidateAttemptQueueState,
  buildScheduledAttemptViews,
  canEnterAttempt,
  getAttemptColdStartWarning,
  getAttemptWaitingMessage,
  getAttemptPrimaryAction,
  getCandidateAttemptDisplayStatus,
  getCandidateCurrentAttemptLabel,
  getCurrentAttemptForExam,
  getLatestAttemptForExam,
  getNextEnterabilityWakeUpDelayMs,
  getNextScheduleAvailableLabelForExam,
} from "./candidate-home-state";
import type { CandidateDashboardData } from "./candidate-scheduling";

const dashboard: CandidateDashboardData = {
  exams: [
    { id: "exam-1", title: "Helios Fundamentals", description: "", timeLimitMinutes: 90, storageLeaseMinutes: 2880, openPeriodMinutes: 120, scoreRetrievalEnabled: true },
    { id: "exam-2", title: "Operations Lab", description: "", timeLimitMinutes: 60, storageLeaseMinutes: null, openPeriodMinutes: 90, scoreRetrievalEnabled: false },
  ],
  attempts: [
    {
      id: "attempt-older",
      examId: "exam-1",
      scheduledFor: "2026-06-15T15:00:00.000Z",
      status: "completed",
    },
    {
      id: "attempt-ready",
      examId: "exam-1",
      scheduledFor: "2026-06-16T16:00:00.000Z",
      status: "ready",
    },
    {
      id: "attempt-scheduled",
      examId: "exam-2",
      scheduledFor: "2026-06-17T10:00:00.000Z",
      status: "scheduled",
    },
  ],
};

describe("candidate home attempt state", () => {
  const originalTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/London";
  });

  afterAll(() => {
    process.env.TZ = originalTimezone;
  });

  it("picks the latest attempt for an exam", () => {
    expect(getLatestAttemptForExam(dashboard.attempts, "exam-1")?.id).toBe("attempt-ready");
  });

  it("picks the latest non-terminal attempt as the current scheduling context", () => {
    expect(
      getCurrentAttemptForExam(
        [
          {
            id: "attempt-latest-completed",
            examId: "exam-1",
            scheduledFor: "2026-06-17T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "attempt-suspended",
            examId: "exam-1",
            scheduledFor: "2026-06-16T09:00:00.000Z",
            status: "suspended",
          },
        ],
        "exam-1",
      )?.id,
    ).toBe("attempt-suspended");
  });

  it("falls back to the latest terminal attempt when no attempt is blocking scheduling", () => {
    expect(
      getCurrentAttemptForExam(
        [
          {
            id: "attempt-older-completed",
            examId: "exam-1",
            scheduledFor: "2026-06-16T09:00:00.000Z",
            status: "completed",
          },
          {
            id: "attempt-latest-expired",
            examId: "exam-1",
            scheduledFor: "2026-06-17T10:00:00.000Z",
            status: "expired",
          },
        ],
        "exam-1",
      )?.id,
    ).toBe("attempt-latest-expired");
  });

  it("builds a visible scheduled attempts list with exam titles", () => {
    const views = buildScheduledAttemptViews(dashboard, new Date("2026-06-16T16:00:00.000Z").getTime());

    expect(views.map((view) => [view.attemptId, view.examTitle])).toEqual([
      ["attempt-scheduled", "Operations Lab"],
      ["attempt-ready", "Helios Fundamentals"],
      ["attempt-older", "Helios Fundamentals"],
    ]);
  });

  it("defaults the candidate attempt queue to live attempts and excludes completed and expired history", () => {
    const queue = buildCandidateAttemptQueueState(
      {
        exams: dashboard.exams,
        attempts: [
          {
            id: "attempt-completed",
            examId: "exam-1",
            scheduledFor: "2026-06-16T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "attempt-expired",
            examId: "exam-1",
            scheduledFor: "2026-06-16T11:00:00.000Z",
            status: "expired",
          },
          {
            id: "attempt-scheduled",
            examId: "exam-1",
            scheduledFor: "2026-06-17T10:00:00.000Z",
            status: "scheduled",
          },
          {
            id: "attempt-progress",
            examId: "exam-2",
            scheduledFor: "2026-06-16T13:00:00.000Z",
            status: "in_progress",
          },
          {
            id: "attempt-suspended",
            examId: "exam-2",
            scheduledFor: "2026-06-16T14:00:00.000Z",
            status: "suspended",
          },
        ],
      },
      new Date("2026-06-16T14:00:00.000Z").getTime(),
    );

    expect(queue.activeFilter).toBe("live");
    expect(queue.attempts.map((attempt) => attempt.attemptId)).toEqual([
      "attempt-scheduled",
      "attempt-suspended",
      "attempt-progress",
    ]);
    expect(queue.filters.map((filter) => [filter.filter, filter.count])).toEqual([
      ["live", 3],
      ["scheduled", 1],
      ["in_progress", 1],
      ["suspended", 1],
      ["completed", 1],
      ["expired", 1],
    ]);
  });

  it("groups ready attempts with scheduled for candidate queue counts and filters history on demand", () => {
    const attempts: CandidateDashboardData["attempts"] = [
      {
        id: "attempt-ready-open",
        examId: "exam-1",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "ready",
      },
      {
        id: "attempt-scheduled",
        examId: "exam-1",
        scheduledFor: "2026-06-17T10:00:00.000Z",
        status: "scheduled",
      },
      {
        id: "attempt-completed",
        examId: "exam-1",
        scheduledFor: "2026-06-15T10:00:00.000Z",
        status: "completed",
      },
      {
        id: "attempt-expired",
        examId: "exam-2",
        scheduledFor: "2026-06-15T11:00:00.000Z",
        status: "expired",
      },
    ];
    const nowMs = new Date("2026-06-16T16:30:00.000Z").getTime();

    const scheduledQueue = buildCandidateAttemptQueueState(
      { exams: dashboard.exams, attempts },
      nowMs,
      "scheduled",
    );
    const completedQueue = buildCandidateAttemptQueueState(
      { exams: dashboard.exams, attempts },
      nowMs,
      "completed",
    );
    const expiredQueue = buildCandidateAttemptQueueState(
      { exams: dashboard.exams, attempts },
      nowMs,
      "expired",
    );

    expect(scheduledQueue.filters.find((filter) => filter.filter === "scheduled")).toMatchObject({
      label: "Scheduled / ready",
      count: 2,
    });
    expect(scheduledQueue.attempts.map((attempt) => attempt.attemptId)).toEqual([
      "attempt-scheduled",
      "attempt-ready-open",
    ]);
    expect(completedQueue.attempts.map((attempt) => attempt.attemptId)).toEqual(["attempt-completed"]);
    expect(expiredQueue.attempts.map((attempt) => attempt.attemptId)).toEqual(["attempt-expired"]);
  });

  it("shows scheduled open-window end details from the authored Exam open period", () => {
    const views = buildScheduledAttemptViews(dashboard, new Date("2026-06-16T16:00:00.000Z").getTime());

    expect(views.find((view) => view.attemptId === "attempt-ready")).toMatchObject({
      scheduledEnd: "2026-06-16T18:00:00.000Z",
      scheduledWindowLabel: "Starts 2026-06-16 17:00 · Closes 2026-06-16 19:00 (120 min)",
    });
  });

  it("shows next schedule availability from storage lease when retention exceeds the access window", () => {
    const views = buildScheduledAttemptViews(dashboard, new Date("2026-06-16T16:00:00.000Z").getTime());

    expect(views.find((view) => view.attemptId === "attempt-ready")).toMatchObject({
      nextScheduleAvailableAt: "2026-06-18T16:00:00.000Z",
      nextScheduleAvailableLabel: "2026-06-18 17:00",
    });
  });

  it("falls back to the authored open period for next schedule availability when storage lease is unknown", () => {
    const views = buildScheduledAttemptViews(dashboard, new Date("2026-06-16T16:00:00.000Z").getTime());

    expect(views.find((view) => view.attemptId === "attempt-scheduled")).toMatchObject({
      nextScheduleAvailableAt: "2026-06-17T11:30:00.000Z",
      nextScheduleAvailableLabel: "2026-06-17 12:30",
    });
  });

  it("does not show next schedule availability for terminal attempts", () => {
    const views = buildScheduledAttemptViews(dashboard, new Date("2026-06-16T16:00:00.000Z").getTime());

    expect(views.find((view) => view.attemptId === "attempt-older")).toMatchObject({
      nextScheduleAvailableAt: null,
      nextScheduleAvailableLabel: null,
    });
  });

  it("derives published Exam next scheduling availability from non-terminal attempts", () => {
    expect(
      getNextScheduleAvailableLabelForExam(
        [
          {
            id: "attempt-latest-completed",
            examId: "exam-1",
            scheduledFor: "2026-06-17T10:00:00.000Z",
            status: "completed",
          },
          {
            id: "attempt-suspended",
            examId: "exam-1",
            scheduledFor: "2026-06-16T09:00:00.000Z",
            status: "suspended",
          },
        ],
        "exam-1",
        dashboard.exams[0],
      ),
    ).toBe("2026-06-18 10:00");
  });

  it("shows the CloudShare cold-start warning on upcoming and active attempts where it applies", () => {
    const views = buildScheduledAttemptViews(
      {
        exams: dashboard.exams,
        attempts: [
          {
            id: "attempt-soon",
            examId: "exam-1",
            scheduledFor: "2026-06-16T16:00:00.000Z",
            status: "ready",
          },
          {
            id: "attempt-active",
            examId: "exam-1",
            scheduledFor: "2026-06-16T15:00:00.000Z",
            status: "in_progress",
          },
          {
            id: "attempt-later",
            examId: "exam-1",
            scheduledFor: "2026-06-17T16:00:00.000Z",
            status: "ready",
          },
        ],
      },
      new Date("2026-06-16T14:00:00.000Z").getTime(),
    );

    expect(views.find((view) => view.attemptId === "attempt-soon")?.coldStartWarning).toBe(
      COLD_START_WARNING_MESSAGE,
    );
    expect(views.find((view) => view.attemptId === "attempt-active")?.coldStartWarning).toBe(
      COLD_START_WARNING_MESSAGE,
    );
    expect(views.find((view) => view.attemptId === "attempt-later")?.coldStartWarning).toBeNull();
  });

  it("stops showing the CloudShare cold-start warning after the authored open period closes", () => {
    const attempt = {
      id: "attempt-closed",
      examId: "exam-1",
      scheduledFor: "2026-06-16T15:00:00.000Z",
      status: "ready" as const,
    };

    expect(
      getAttemptColdStartWarning(
        attempt,
        new Date("2026-06-16T17:01:00.000Z").getTime(),
        dashboard.exams[0],
      ),
    ).toBeNull();
  });

  it("does not show the individual exam cold-start warning for Cohort Exam Session attempts", () => {
    const attempt = {
      id: "attempt-cohort",
      examId: "exam-1",
      cohortSessionId: "cohort-session-1",
      scheduledFor: "2026-06-16T15:00:00.000Z",
      status: "in_progress" as const,
    };

    expect(
      getAttemptColdStartWarning(
        attempt,
        new Date("2026-06-16T14:30:00.000Z").getTime(),
        dashboard.exams[0],
      ),
    ).toBeNull();
  });

  it("does not keep the CloudShare cold-start warning on long-running attempts more than five hours after start", () => {
    const attempt = {
      id: "attempt-long-open",
      examId: "exam-long-open",
      scheduledFor: "2026-06-16T10:00:00.000Z",
      status: "in_progress" as const,
    };
    const exam = {
      id: "exam-long-open",
      title: "Long Open Window",
      description: "",
      timeLimitMinutes: 120,
      storageLeaseMinutes: null,
      openPeriodMinutes: 24 * 60,
      scoreRetrievalEnabled: false,
    };

    expect(
      getAttemptColdStartWarning(
        attempt,
        new Date("2026-06-16T16:01:00.000Z").getTime(),
        exam,
      ),
    ).toBeNull();
  });

  it("derives closed-window candidate display state without changing the raw attempt lifecycle", () => {
    const closedReadyAttempt = {
      id: "attempt-ready-closed",
      examId: "exam-1",
      scheduledFor: "2026-06-16T16:00:00.000Z",
      status: "ready" as const,
    };
    const closedSuspendedAttempt = {
      id: "attempt-suspended-closed",
      examId: "exam-1",
      scheduledFor: "2026-06-16T16:00:00.000Z",
      status: "suspended" as const,
    };
    const nowMs = new Date("2026-06-16T18:00:01.000Z").getTime();

    expect(getCandidateAttemptDisplayStatus(closedReadyAttempt, nowMs, dashboard.exams[0])).toBe("expired");
    expect(getCandidateAttemptDisplayStatus(closedSuspendedAttempt, nowMs, dashboard.exams[0])).toBe("completed");
    expect(
      getCandidateCurrentAttemptLabel(closedSuspendedAttempt, nowMs, dashboard.exams[0]),
    ).toBe("Completed for 2026-06-16 17:00");
    expect(buildScheduledAttemptViews({
      exams: dashboard.exams,
      attempts: [closedReadyAttempt],
    }, nowMs)[0]).toMatchObject({
      status: "ready",
      displayStatus: "expired",
    });
  });

  it("shows a future persisted ready attempt as scheduled until the scheduled start", () => {
    const readyAttempt = {
      id: "attempt-ready-future",
      examId: "exam-1",
      scheduledFor: "2026-06-16T16:00:00.000Z",
      status: "ready" as const,
    };

    const beforeStartView = buildScheduledAttemptViews(
      {
        exams: dashboard.exams,
        attempts: [readyAttempt],
      },
      new Date("2026-06-16T15:59:00.000Z").getTime(),
    )[0];

    expect(beforeStartView).toMatchObject({
      status: "ready",
      displayStatus: "scheduled",
      canEnter: false,
      waitingMessage: "Enter exam becomes available at 2026-06-16 17:00.",
    });
    expect(
      getCandidateCurrentAttemptLabel(
        readyAttempt,
        new Date("2026-06-16T15:59:00.000Z").getTime(),
        dashboard.exams[0],
      ),
    ).toBe("Scheduled for 2026-06-16 17:00");

    const atStartView = buildScheduledAttemptViews(
      {
        exams: dashboard.exams,
        attempts: [readyAttempt],
      },
      new Date("2026-06-16T16:00:00.000Z").getTime(),
    )[0];

    expect(atStartView).toMatchObject({
      status: "ready",
      displayStatus: "ready",
      canEnter: true,
      waitingMessage: null,
    });
    expect(
      getCandidateCurrentAttemptLabel(
        readyAttempt,
        new Date("2026-06-16T16:00:00.000Z").getTime(),
        dashboard.exams[0],
      ),
    ).toBe("Ready for 2026-06-16 17:00");
  });

  it("keeps score review available for completed Guided Journey attempts before the open window closes", () => {
    const completedAttempt = {
      id: "attempt-completed",
      examId: "exam-1",
      scheduledFor: "2026-06-16T16:00:00.000Z",
      status: "completed" as const,
    };
    const nowMs = new Date("2026-06-16T16:30:00.000Z").getTime();

    expect(getAttemptPrimaryAction(completedAttempt, nowMs, dashboard.exams[0])).toEqual({
      label: "View score",
      disabled: false,
    });
  });

  it("uses attempt-scoped Exam timing when the Exam is no longer in the published catalog", () => {
    const nowMs = new Date("2026-06-16T18:00:01.000Z").getTime();
    const views = buildScheduledAttemptViews(
      {
        exams: [],
        attempts: [
          {
            id: "attempt-unpublished-ready",
            examId: "exam-unpublished",
            examTitle: "Unpublished Windows Boxes",
            timeLimitMinutes: 10,
            openPeriodMinutes: 20,
            scoreRetrievalEnabled: true,
            scheduledFor: "2026-06-16T16:00:00.000Z",
            status: "ready",
          },
        ],
      },
      nowMs,
    );

    expect(views[0]).toMatchObject({
      examTitle: "Unpublished Windows Boxes",
      openPeriodMinutes: 20,
      scoreRetrievalEnabled: true,
      displayStatus: "expired",
      scheduledWindowLabel: "Starts 2026-06-16 17:00 · Closes 2026-06-16 17:20 (20 min)",
    });
  });

  it("builds candidate-facing labels for runtime limit and open period", () => {
    expect(buildCandidateExamDurationLabels(dashboard.exams[0]!)).toEqual({
      runtimeLimit: "90 minute runtime limit",
      openWindow: "120 minute open window",
      openPeriodDetail: "120 minutes from scheduled start",
    });
  });

  it("allows enter only for ready attempts at or after the scheduled time", () => {
    expect(
      canEnterAttempt(dashboard.attempts[1] ?? null, new Date("2026-06-16T16:00:00.000Z").getTime()),
    ).toBe(true);
    expect(
      canEnterAttempt(dashboard.attempts[1] ?? null, new Date("2026-06-16T15:59:59.000Z").getTime()),
    ).toBe(false);
  });

  it("emits waiting text for a ready attempt before entry opens", () => {
    expect(
      getAttemptWaitingMessage(
        dashboard.attempts[1] ?? null,
        new Date("2026-06-16T15:00:00.000Z").getTime(),
      ),
    ).toBe("Enter exam becomes available at 2026-06-16 17:00.");
  });

  it("formats the current-attempt label without appending invalid scheduled times", () => {
    expect(getCandidateCurrentAttemptLabel(dashboard.attempts[1] ?? null)).toBe(
      "Ready for 2026-06-16 17:00",
    );
    expect(
      getCandidateCurrentAttemptLabel({
        id: "attempt-invalid",
        examId: "exam-1",
        scheduledFor: "not-a-date",
        status: "ready",
      }),
    ).toBe("Ready");
    expect(getCandidateCurrentAttemptLabel(null)).toBe("No attempt scheduled");
  });

  it.each([
    {
      attempt: dashboard.attempts[1] ?? null,
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T15:00:00.000Z").getTime(),
      expected: { label: "Enter exam", disabled: true },
    },
    {
      attempt: dashboard.attempts[1] ?? null,
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T16:00:00.000Z").getTime(),
      expected: { label: "Enter exam", disabled: false },
    },
    {
      attempt: {
        id: "attempt-progress",
        examId: "exam-1",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "in_progress" as const,
      },
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T16:00:00.000Z").getTime(),
      expected: { label: "Return to exam", disabled: false },
    },
    {
      attempt: {
        id: "attempt-suspended",
        examId: "exam-1",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "suspended" as const,
      },
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T16:00:00.000Z").getTime(),
      expected: { label: "Resume exam", disabled: false },
    },
    {
      attempt: {
        id: "attempt-completed",
        examId: "exam-1",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "completed" as const,
      },
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T16:00:00.000Z").getTime(),
      expected: { label: "View score", disabled: false },
    },
    {
      attempt: {
        id: "attempt-completed",
        examId: "exam-1",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "completed" as const,
      },
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T18:00:01.000Z").getTime(),
      expected: { label: "View score", disabled: false },
    },
    {
      attempt: dashboard.attempts[2] ?? null,
      exam: dashboard.exams[1] ?? null,
      nowMs: new Date("2026-06-17T10:00:00.000Z").getTime(),
      expected: { label: null, disabled: false },
    },
    {
      attempt: dashboard.attempts[1] ?? null,
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T18:00:01.000Z").getTime(),
      expected: { label: null, disabled: false },
    },
    {
      attempt: {
        id: "attempt-progress",
        examId: "exam-1",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "in_progress" as const,
      },
      exam: dashboard.exams[0] ?? null,
      nowMs: new Date("2026-06-16T18:00:01.000Z").getTime(),
      expected: { label: "View score", disabled: false },
    },
    {
      attempt: {
        id: "attempt-suspended",
        examId: "exam-2",
        scheduledFor: "2026-06-16T16:00:00.000Z",
        status: "suspended" as const,
      },
      exam: dashboard.exams[1] ?? null,
      nowMs: new Date("2026-06-16T17:30:01.000Z").getTime(),
      expected: { label: null, disabled: false },
    },
  ])("maps candidate-home primary actions from the portal-owned open window", ({ attempt, exam, nowMs, expected }) => {
    expect(getAttemptPrimaryAction(attempt, nowMs, exam)).toEqual(expected);
  });

  it("computes a one-shot wake-up delay for the next ready attempt that will become enterable", () => {
    const delayMs = getNextEnterabilityWakeUpDelayMs(
      dashboard.attempts,
      new Date("2026-06-16T15:59:59.000Z").getTime(),
    );

    expect(delayMs).toBeGreaterThan(1_000);
    expect(delayMs).toBeLessThanOrEqual(1_500);
  });

  it("computes a wake-up delay for an active attempt when its authored open period closes", () => {
    const delayMs = getNextEnterabilityWakeUpDelayMs(
      [
        {
          id: "attempt-progress",
          examId: "exam-1",
          scheduledFor: "2026-06-16T16:00:00.000Z",
          status: "in_progress",
        },
      ],
      new Date("2026-06-16T17:59:59.000Z").getTime(),
      dashboard.exams,
    );

    expect(delayMs).toBeGreaterThan(1_000);
    expect(delayMs).toBeLessThanOrEqual(1_500);
  });

  it("caps a far-future wake-up delay to the safe maximum chunk", () => {
    const farFutureAttempts: CandidateDashboardData["attempts"] = [
      {
        id: "attempt-far",
        examId: "exam-1",
        scheduledFor: "2027-08-01T10:00:00.000Z",
        status: "ready",
      },
    ];

    expect(
      getNextEnterabilityWakeUpDelayMs(
        farFutureAttempts,
        new Date("2026-06-16T10:00:00.000Z").getTime(),
      ),
    ).toBe(MAX_ENTERABILITY_WAKE_UP_DELAY_MS);
  });

  it("returns null when no future ready attempt needs an enterability wake-up", () => {
    expect(
      getNextEnterabilityWakeUpDelayMs(
        dashboard.attempts,
        new Date("2026-06-18T10:00:00.000Z").getTime(),
      ),
    ).toBeNull();
  });
});
