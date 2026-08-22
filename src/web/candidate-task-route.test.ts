import { describe, expect, it } from "vitest";
import {
  buildCandidateTaskHref,
  getCandidateTaskForAttemptStatus,
  parseCandidateTaskRoute,
  resolveCandidateTaskRoute,
  type CandidateTaskRoute,
} from "./candidate-task-route";
import type { CandidateDashboardData } from "./candidate-scheduling";

const dashboard: CandidateDashboardData = {
  exams: [
    {
      id: "exam-1",
      title: "Helios Fundamentals",
      description: "",
      timeLimitMinutes: 90,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 120,
      scoreRetrievalEnabled: true,
      individualSchedulingEnabled: true,
      availableCohortSessions: [],
    },
    {
      id: "exam-2",
      title: "Operations Lab",
      description: "",
      timeLimitMinutes: 60,
      storageLeaseMinutes: null,
      openPeriodMinutes: 90,
      scoreRetrievalEnabled: false,
      individualSchedulingEnabled: true,
      availableCohortSessions: [],
    },
  ],
  attempts: [
    {
      id: "attempt-ready",
      examId: "exam-1",
      scheduledFor: "2026-06-16T16:00:00.000Z",
      status: "ready",
    },
    {
      id: "attempt-completed",
      examId: "exam-1",
      scheduledFor: "2026-06-15T10:00:00.000Z",
      status: "completed",
    },
  ],
};

describe("candidate task route", () => {
  it("parses only supported task route parameters", () => {
    expect(parseCandidateTaskRoute({ task: "history", attemptId: "attempt-1", examId: "exam-2" })).toEqual({
      task: "history",
      attemptId: "attempt-1",
      examId: "exam-2",
    });
    expect(parseCandidateTaskRoute({ task: "unknown", attemptId: "  ", examId: "" })).toEqual({
      task: null,
      attemptId: null,
      examId: null,
    });
  });

  it("keeps a requested live ExamAttempt as the route-backed current task", () => {
    const resolved = resolveCandidateTaskRoute(
      dashboard,
      new Date("2026-06-16T15:59:00.000Z").getTime(),
      parseCandidateTaskRoute({ task: "current", attemptId: "attempt-ready" }),
    );

    expect(resolved.activeTask).toBe("current");
    expect(resolved.selectedAttempt?.attemptId).toBe("attempt-ready");
    expect(resolved.notice).toBeNull();
    expect(resolved.tasks.map((task) => task.label)).toEqual([
      "Current ExamAttempt",
      "Schedule exam",
      "Attempt history",
    ]);
  });

  it("fails safely when a requested live ExamAttempt is stale and falls back to the current live task", () => {
    const resolved = resolveCandidateTaskRoute(
      dashboard,
      new Date("2026-06-16T15:59:00.000Z").getTime(),
      parseCandidateTaskRoute({ task: "current", attemptId: "attempt-missing" }),
    );

    expect(resolved.activeTask).toBe("current");
    expect(resolved.selectedAttempt?.attemptId).toBe("attempt-ready");
    expect(resolved.notice).toBe(
      "The requested ExamAttempt is no longer available in this live task view.",
    );
  });

  it("keeps history route state separate from the live current task", () => {
    const resolved = resolveCandidateTaskRoute(
      dashboard,
      new Date("2026-06-16T15:59:00.000Z").getTime(),
      parseCandidateTaskRoute({ task: "history", attemptId: "attempt-completed" }),
    );

    expect(resolved.activeTask).toBe("history");
    expect(resolved.selectedAttempt?.attemptId).toBe("attempt-completed");
    expect(resolved.attempts.map((attempt) => attempt.attemptId)).toEqual(["attempt-completed"]);
  });

  it("falls back to schedule when no live attempts exist", () => {
    const resolved = resolveCandidateTaskRoute(
      {
        exams: dashboard.exams,
        attempts: [{
          id: "attempt-completed",
          examId: "exam-1",
          scheduledFor: "2026-06-15T10:00:00.000Z",
          status: "completed",
        }],
      },
      new Date("2026-06-16T15:59:00.000Z").getTime(),
      { task: "current", attemptId: null, examId: null } satisfies CandidateTaskRoute,
    );

    expect(resolved.activeTask).toBe("schedule");
    expect(resolved.selectedExam?.id).toBe("exam-1");
    expect(resolved.notice).toBe("No live ExamAttempt is available right now. Choose another published Exam.");
  });

  it("fails safely when a requested published Exam is unavailable", () => {
    const resolved = resolveCandidateTaskRoute(
      dashboard,
      new Date("2026-06-16T15:59:00.000Z").getTime(),
      parseCandidateTaskRoute({ task: "schedule", examId: "exam-missing" }),
    );

    expect(resolved.activeTask).toBe("schedule");
    expect(resolved.selectedExam?.id).toBe("exam-1");
    expect(resolved.notice).toBe("That published Exam is no longer available. Choose another published Exam.");
  });

  it("keeps the no-published-exams discovery state route-backed", () => {
    const resolved = resolveCandidateTaskRoute(
      { exams: [], attempts: [] },
      new Date("2026-06-16T15:59:00.000Z").getTime(),
      parseCandidateTaskRoute({ task: "schedule" }),
    );

    expect(resolved.activeTask).toBe("schedule");
    expect(resolved.selectedExam).toBeNull();
    expect(resolved.notice).toBe("No published Exams are available yet.");
  });

  it("builds attempt return routes from the attempt status without collapsing history into current", () => {
    expect(getCandidateTaskForAttemptStatus("ready")).toBe("current");
    expect(getCandidateTaskForAttemptStatus("in_progress")).toBe("current");
    expect(getCandidateTaskForAttemptStatus("suspended")).toBe("current");
    expect(getCandidateTaskForAttemptStatus("completed")).toBe("history");
    expect(getCandidateTaskForAttemptStatus("expired")).toBe("history");
    expect(buildCandidateTaskHref({ task: "history", attemptId: "attempt-completed", examId: null })).toBe(
      "/candidate?task=history&attemptId=attempt-completed",
    );
  });
});
