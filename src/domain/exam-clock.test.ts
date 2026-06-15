import { describe, expect, it } from "vitest";
import {
  createExamClock,
  createInMemoryExamClockRepository,
  type ExamClock,
} from "./exam-clock";

describe("ExamClock", () => {
  it("banks elapsed time across pause/resume cycles and survives recreating the service", async () => {
    const repository = createInMemoryExamClockRepository();
    let nowMs = 0;

    const createService = (): ExamClock =>
      createExamClock({
        clocks: repository,
        now: () => new Date(nowMs),
      });

    const first = createService();

    await first.resumeTimer("attempt-1");
    nowMs = 1_000;
    await first.pauseTimer("attempt-1");

    expect(await first.getTimerState("attempt-1")).toMatchObject({
      examAttemptId: "attempt-1",
      status: "paused",
      elapsedAtPauseMs: 1_000,
    });

    const restarted = createService();

    nowMs = 5_000;
    await restarted.resumeTimer("attempt-1");
    nowMs = 6_500;
    await restarted.pauseTimer("attempt-1");

    expect(await restarted.getTimerState("attempt-1")).toMatchObject({
      examAttemptId: "attempt-1",
      status: "paused",
      elapsedAtPauseMs: 2_500,
    });
  });
});
