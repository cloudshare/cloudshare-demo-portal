import { describe, expect, it } from "vitest";
import {
  isValidCandidateIdentifier,
  buildCandidateTaskHref,
  getCandidateTaskForAttemptStatus,
  getCandidateTaskNavigationRoute,
  parseCandidateTaskRoute,
  parseCandidateTaskSearchParams,
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

describe("candidate route identifiers", () => {
  it.each(["attempt-1", "exam_1", "A1", "0-start"]) ("accepts %s", (value) => {
    expect(isValidCandidateIdentifier(value)).toBe(true);
  });

  it.each(["-attempt", "_exam", " attempt", "attempt ", ""]) ("rejects %s", (value) => {
    expect(isValidCandidateIdentifier(value)).toBe(false);
  });
});

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
      "Current Exam Attempt",
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
      "The requested Exam Attempt is no longer available in this live task view.",
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
    expect(resolved.notice).toBe("No live Exam Attempt is available right now. Choose another published Exam.");
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

  it("keeps published Exam order stable when Schedule selection changes", () => {
    const reversed = { ...dashboard, exams: [...dashboard.exams].reverse() };
    const first = resolveCandidateTaskRoute(reversed, Date.parse("2026-06-16T15:59:00.000Z"), {
      task: "schedule", attemptId: null, examId: "exam-1",
    });
    const second = resolveCandidateTaskRoute(reversed, Date.parse("2026-06-16T15:59:00.000Z"), {
      task: "schedule", attemptId: null, examId: "exam-2",
    });

    expect(first.exams.map((exam) => exam.id)).toEqual(["exam-1", "exam-2"]);
    expect(second.exams.map((exam) => exam.id)).toEqual(["exam-1", "exam-2"]);
    expect(first.selectedExam?.id).toBe("exam-1");
    expect(second.selectedExam?.id).toBe("exam-2");
  });

  it("fails closed for duplicate or invalid URL query shapes", () => {
    const fallback = { task: "current" as const, attemptId: "safe", examId: "exam-1" };
    const duplicate = new URLSearchParams("task=current&task=history&attemptId=safe&examId=exam-1");
    const empty = { task: null, attemptId: null, examId: null };
    expect(parseCandidateTaskSearchParams(duplicate, fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=current&attemptId=safe&attemptId=evil"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=current&examId=exam-1&examId=evil"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=unknown"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=current&unknown=value"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=current&attemptId=bad%20id"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("attemptId=safe"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=schedule&attemptId=safe"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=current&examId=exam-1"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=history&examId=exam-1"), fallback)).toEqual(empty);
    expect(parseCandidateTaskSearchParams(new URLSearchParams("task=schedule&examId=exam-1"), fallback)).toEqual({ task: "schedule", attemptId: null, examId: "exam-1" });
    expect(parseCandidateTaskSearchParams(new URLSearchParams(), fallback)).toEqual(fallback);
  });

  it("keeps current attempts in stable schedule order when their statuses change", () => {
    const resolved = resolveCandidateTaskRoute({ ...dashboard, attempts: [
      { id: "future", examId: "exam-2", scheduledFor: "2026-06-20T10:00:00.000Z", status: "ready" },
      { id: "running", examId: "exam-1", scheduledFor: "2026-06-16T15:00:00.000Z", status: "in_progress" },
      { id: "paused", examId: "exam-2", scheduledFor: "2026-06-16T15:30:00.000Z", status: "suspended" },
    ] }, Date.parse("2026-06-16T15:59:00.000Z"), { task: "current", attemptId: null, examId: null });
    expect(resolved.selectedAttempt?.attemptId).toBe("running");
    expect(resolved.attempts.map((attempt) => attempt.attemptId)).toEqual(["future", "paused", "running"]);

    const refreshed = resolveCandidateTaskRoute({ ...dashboard, attempts: [
      { id: "future", examId: "exam-2", scheduledFor: "2026-06-20T10:00:00.000Z", status: "in_progress" },
      { id: "running", examId: "exam-1", scheduledFor: "2026-06-16T15:00:00.000Z", status: "suspended" },
      { id: "paused", examId: "exam-2", scheduledFor: "2026-06-16T15:30:00.000Z", status: "ready" },
    ] }, Date.parse("2026-06-16T15:59:00.000Z"), { task: "current", attemptId: null, examId: null });
    expect(refreshed.attempts.map((attempt) => attempt.attemptId)).toEqual(["future", "paused", "running"]);
  });

  it.each(["in_progress", "suspended"] as const)("moves %s to history when its open period is closed", (status) => {
    expect(getCandidateTaskForAttemptStatus(status, true)).toBe("history");
    expect(getCandidateTaskForAttemptStatus(status, false)).toBe("current");
  });

  it("uses truthful current fallback copy when history remains but the catalogue is empty", () => {
    const resolved = resolveCandidateTaskRoute(
      { exams: [], attempts: [{
        id: "attempt-completed", examId: "retired-exam", scheduledFor: "2026-06-15T10:00:00.000Z", status: "completed",
      }] },
      Date.parse("2026-06-16T15:59:00.000Z"),
      { task: "current", attemptId: null, examId: null },
    );
    expect(resolved.activeTask).toBe("history");
    expect(resolved.notice).toBe("No live Exam Attempt is available right now, and no published Exams are available yet.");
    expect(resolved.notice).not.toContain("Choose another published Exam");
  });

  it("keeps an active Schedule selection when navigating to Schedule again", () => {
    const resolved = resolveCandidateTaskRoute(dashboard, Date.parse("2026-06-16T15:59:00.000Z"), {
      task: "schedule", attemptId: null, examId: "exam-2",
    });
    expect(getCandidateTaskNavigationRoute("schedule", resolved)).toEqual({
      task: "schedule", attemptId: null, examId: "exam-2",
    });
  });

  it.each(["current", "history"] as const)("chooses a deterministic unattempted published exam from %s", (task) => {
    const resolved = resolveCandidateTaskRoute(dashboard, Date.parse("2026-06-16T15:59:00.000Z"), {
      task, attemptId: task === "current" ? "attempt-ready" : "attempt-completed", examId: null,
    });
    expect(getCandidateTaskNavigationRoute("schedule", resolved)).toEqual({
      task: "schedule", attemptId: null, examId: "exam-2",
    });
    expect(resolveCandidateTaskRoute(dashboard, Date.parse("2026-06-16T15:59:00.000Z"),
      getCandidateTaskNavigationRoute("schedule", resolved)).selectedExam?.id).toBe("exam-2");
  });

  it("routes tabs to the newest valid attempt and has deterministic schedule fallbacks", () => {
    const data = { ...dashboard, attempts: [
      ...dashboard.attempts,
      { id: "attempt-new-live", examId: "exam-2", scheduledFor: "2026-06-16T17:00:00.000Z", status: "ready" as const },
      { id: "attempt-new-history", examId: "exam-2", scheduledFor: "2026-06-16T18:00:00.000Z", status: "completed" as const },
    ] };
    const resolved = resolveCandidateTaskRoute(data, Date.parse("2026-06-16T16:30:00.000Z"), { task: "schedule", attemptId: null, examId: null });
    expect(getCandidateTaskNavigationRoute("current", resolved)).toEqual({ task: "current", attemptId: "attempt-ready", examId: "exam-1" });
    expect(getCandidateTaskNavigationRoute("history", resolved)).toEqual({ task: "history", attemptId: "attempt-new-history", examId: "exam-2" });
    expect(getCandidateTaskNavigationRoute("schedule", resolved)).toEqual({ task: "schedule", attemptId: null, examId: "exam-1" });
    expect(getCandidateTaskNavigationRoute("schedule", resolveCandidateTaskRoute({ exams: [], attempts: data.attempts }, Date.now(), { task: "history", attemptId: null, examId: null }))).toEqual({ task: "schedule", attemptId: null, examId: null });
  });

  it("routes Current to the highest-priority active attempt after leaving Schedule or History", () => {
    const data = { ...dashboard, attempts: [
      { id: "future", examId: "exam-2", scheduledFor: "2026-06-20T10:00:00.000Z", status: "ready" as const },
      { id: "running", examId: "exam-1", scheduledFor: "2026-06-16T15:00:00.000Z", status: "in_progress" as const },
    ] };
    for (const task of ["schedule", "history"] as const) {
      const resolved = resolveCandidateTaskRoute(data, Date.parse("2026-06-16T15:59:00.000Z"), { task, attemptId: null, examId: null });
      const route = getCandidateTaskNavigationRoute("current", resolved);
      expect(route).toEqual({ task: "current", attemptId: "running", examId: "exam-1" });
      expect(resolveCandidateTaskRoute(data, Date.parse("2026-06-16T15:59:00.000Z"), route).selectedAttempt?.attemptId).toBe("running");
    }
  });

  it("falls back deterministically when every published exam was attempted", () => {
    const resolved = resolveCandidateTaskRoute({ ...dashboard, attempts: [...dashboard.attempts, { id: "attempt-2", examId: "exam-2", scheduledFor: "2026-06-16T09:00:00.000Z", status: "completed" }] }, Date.now(), { task: "current", attemptId: "attempt-ready", examId: null });
    expect(getCandidateTaskNavigationRoute("schedule", resolved)).toEqual({ task: "schedule", attemptId: null, examId: "exam-1" });
  });
});
