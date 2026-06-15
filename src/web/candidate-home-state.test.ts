import { describe, expect, it } from "vitest";
import {
  buildScheduledAttemptViews,
  canEnterAttempt,
  getAttemptWaitingMessage,
  getLatestAttemptForExam,
} from "./candidate-home-state";
import type { CandidateDashboardData } from "./candidate-scheduling";

const dashboard: CandidateDashboardData = {
  exams: [
    { id: "exam-1", title: "Helios Fundamentals", description: "", timeLimitMinutes: 90 },
    { id: "exam-2", title: "Operations Lab", description: "", timeLimitMinutes: 60 },
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
  it("picks the latest attempt for an exam", () => {
    expect(getLatestAttemptForExam(dashboard.attempts, "exam-1")?.id).toBe("attempt-ready");
  });

  it("builds a visible scheduled attempts list with exam titles", () => {
    const views = buildScheduledAttemptViews(dashboard, new Date("2026-06-16T16:00:00.000Z").getTime());

    expect(views.map((view) => [view.attemptId, view.examTitle])).toEqual([
      ["attempt-scheduled", "Operations Lab"],
      ["attempt-ready", "Helios Fundamentals"],
      ["attempt-older", "Helios Fundamentals"],
    ]);
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
    ).toMatch(/Enter exam becomes available/);
  });
});
