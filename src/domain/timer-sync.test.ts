import { describe, it, expect, vi } from "vitest";
import {
  suspendExam,
  resumeExam,
  SUSPENDED_PRESERVATION_LIMIT_MS,
  type ExamTimer,
  type EnvironmentController,
  type SuspendExamDeps,
  type ResumeExamDeps,
} from "./timer-sync";
import type { EnvironmentStateSource } from "./environment";
import type { LabLaunchRepository, LabProvisioner } from "./lab-launch";
import { TimerSyncError } from "./errors";

const noSleep = () => Promise.resolve();

function makeTimer(): ExamTimer & { paused: string[]; resumed: string[] } {
  const paused: string[] = [];
  const resumed: string[] = [];
  return {
    paused,
    resumed,
    pauseTimer: (id) => { paused.push(id); return Promise.resolve(); },
    resumeTimer: (id) => { resumed.push(id); return Promise.resolve(); },
  };
}

function makeController(): EnvironmentController & { suspended: string[]; resumed: string[] } {
  const suspended: string[] = [];
  const resumed: string[] = [];
  return {
    suspended,
    resumed,
    suspendEnvironment: (id) => { suspended.push(id); return Promise.resolve(); },
    resumeEnvironment: (id) => { resumed.push(id); return Promise.resolve(); },
  };
}

/** Source that always returns the given status. */
function fixedSource(status: string): EnvironmentStateSource {
  return {
    getEnvironmentState: (id) =>
      Promise.resolve({ environmentExternalId: id, status: status as never }),
  };
}

/** Source that returns `before` for the first N calls, then `after`. */
function eventualSource(before: string, after: string, callsUntilAfter = 1): EnvironmentStateSource {
  let calls = 0;
  return {
    getEnvironmentState: (id) => {
      calls++;
      const status = calls > callsUntilAfter ? after : before;
      return Promise.resolve({ environmentExternalId: id, status: status as never });
    },
  };
}

const launch = {
  id: "launch-1",
  examAttemptId: "ea-1",
  candidateId: "cand-1",
  experienceId: "exp-1",
  environmentExternalId: "env-1",
  loginUrl: "https://old.lab.url/login",
  status: "launched" as const,
  createdAt: new Date(),
};

function makeLaunches(found: typeof launch | null = launch): LabLaunchRepository {
  return {
    save: () => Promise.resolve(),
    findById: () => Promise.resolve(null),
    findByExamAttemptId: () => Promise.resolve(found),
  };
}

function makeLabs(loginUrl = "https://new.lab.url/login"): LabProvisioner {
  return {
    createExperience: () => Promise.resolve({ experienceId: "exp-1" }),
    addStudent: () => Promise.resolve(),
    createSponsoredLink: () => Promise.resolve({ loginUrl }),
  };
}

// --- SUSPENDED_PRESERVATION_LIMIT_MS ---

describe("SUSPENDED_PRESERVATION_LIMIT_MS", () => {
  it("is exactly 2 hours in milliseconds", () => {
    expect(SUSPENDED_PRESERVATION_LIMIT_MS).toBe(2 * 60 * 60 * 1000);
  });
});

// --- suspendExam ---

describe("suspendExam", () => {
  it("issues suspend, polls until suspended, then pauses the exam timer", async () => {
    const controller = makeController();
    const timer = makeTimer();
    const source = fixedSource("suspended");

    await suspendExam(
      { controller, source, timer, launches: makeLaunches(), sleep: noSleep },
      { examAttemptId: "ea-1" },
    );

    expect(controller.suspended).toEqual(["env-1"]);
    expect(timer.paused).toEqual(["ea-1"]);
  });

  it("throws TimerSyncError if no lab launch exists for the exam attempt", async () => {
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer: makeTimer(),
          launches: makeLaunches(null),
          sleep: noSleep,
        },
        { examAttemptId: "ea-missing" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("retries polling until the status reaches suspended", async () => {
    const controller = makeController();
    const timer = makeTimer();
    const source = eventualSource("running", "suspended", 2);

    await suspendExam(
      {
        controller,
        source,
        timer,
        launches: makeLaunches(),
        sleep: noSleep,
        poll: { maxAttempts: 5, intervalMs: 0 },
      },
      { examAttemptId: "ea-1" },
    );

    expect(timer.paused).toEqual(["ea-1"]);
  });

  it("throws TimerSyncError if the environment never reaches suspended within maxAttempts", async () => {
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: fixedSource("running"),
          timer: makeTimer(),
          launches: makeLaunches(),
          sleep: noSleep,
          poll: { maxAttempts: 3, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("does NOT pause the timer if polling fails", async () => {
    const timer = makeTimer();
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: fixedSource("running"),
          timer,
          launches: makeLaunches(),
          sleep: noSleep,
          poll: { maxAttempts: 1, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
    expect(timer.paused).toHaveLength(0);
  });
});

// --- resumeExam ---

describe("resumeExam", () => {
  it("issues resume, polls until running, resumes the timer, and returns a new loginUrl", async () => {
    const controller = makeController();
    const timer = makeTimer();
    const newUrl = "https://new.lab.url/login";

    const result = await resumeExam(
      {
        controller,
        source: fixedSource("running"),
        timer,
        launches: makeLaunches(),
        labs: makeLabs(newUrl),
        sleep: noSleep,
      },
      { examAttemptId: "ea-1" },
    );

    expect(controller.resumed).toEqual(["env-1"]);
    expect(timer.resumed).toEqual(["ea-1"]);
    expect(result.loginUrl).toBe(newUrl);
    expect(result.environmentExternalId).toBe("env-1");
    expect(result.suspendedPreservationLimitMs).toBe(SUSPENDED_PRESERVATION_LIMIT_MS);
  });

  it("throws TimerSyncError if no lab launch exists for the exam attempt", async () => {
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: fixedSource("running"),
          timer: makeTimer(),
          launches: makeLaunches(null),
          labs: makeLabs(),
          sleep: noSleep,
        },
        { examAttemptId: "ea-missing" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("throws TimerSyncError if the environment never reaches running within maxAttempts", async () => {
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer: makeTimer(),
          launches: makeLaunches(),
          labs: makeLabs(),
          sleep: noSleep,
          poll: { maxAttempts: 2, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("does NOT resume the timer if polling fails", async () => {
    const timer = makeTimer();
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer,
          launches: makeLaunches(),
          labs: makeLabs(),
          sleep: noSleep,
          poll: { maxAttempts: 1, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
    expect(timer.resumed).toHaveLength(0);
  });
});
