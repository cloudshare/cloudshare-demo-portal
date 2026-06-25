import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import type { Logger } from "@/observability/logger";
import type { ExamTimer } from "@/domain/timer-sync";
import { enterExamAttemptRuntime } from "./exam-attempt-runtime";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeTimer(): ExamTimer & { resumed: string[] } {
  const resumed: string[] = [];
  return {
    resumed,
    pauseTimer: vi.fn().mockResolvedValue(undefined),
    resumeTimer: vi.fn(async (examAttemptId: string) => {
      resumed.push(examAttemptId);
    }),
  };
}

describe("enterExamAttemptRuntime", () => {
  it("returns a typed redirect result and starts a ready ExamAttempt", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const timer = makeTimer();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toEqual({
      kind: "redirect",
      location: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      body: "Redirecting to the CloudShare lab.",
    });
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("blocks entry before scheduled time without exposing the sponsored link", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T15:59:59.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toEqual({
      kind: "blocked",
      status: 403,
      body: { message: "Exam entry is not available before the scheduled start time." },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("allows an in-progress ExamAttempt to re-enter and resumes the clock idempotently", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const timer = makeTimer();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:05:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toMatchObject({
      kind: "redirect",
      location: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    });
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });
});
