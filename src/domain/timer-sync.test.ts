import { describe, it, expect } from "vitest";
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
import type { LabLaunch, LabLaunchRepository, LabProvisioner } from "./lab-launch";
import { TimerSyncError, LabLaunchNotFoundError } from "./errors";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";

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

/** Source that always returns null (environment unknown). */
const nullSource: EnvironmentStateSource = {
  getEnvironmentState: () => Promise.resolve(null),
};

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
  environmentExternalId: "ENVS-test-env-1",
  loginUrl: "https://old.lab.url/login",
  status: "launched" as const,
  createdAt: new Date(),
};

function makeLaunches(found: LabLaunch | null = launch): LabLaunchRepository {
  let current: LabLaunch | null = found;
  return {
    save: (value) => {
      current = value;
      return Promise.resolve();
    },
    findById: () => Promise.resolve(current),
    findByExamAttemptId: () => Promise.resolve(current),
  };
}

function makeLabs(loginUrl = "https://new.lab.url/login"): LabProvisioner & { createSponsoredLinkCalls: number } {
  let createSponsoredLinkCalls = 0;
  return {
    get createSponsoredLinkCalls() {
      return createSponsoredLinkCalls;
    },
    createExperience: () => Promise.resolve({ experienceId: "exp-1" }),
    addStudent: () => Promise.resolve(),
    createSponsoredLink: () => {
      createSponsoredLinkCalls++;
      return Promise.resolve({ loginUrl });
    },
  };
}

async function makeAttempts(
  status: "ready" | "scheduled" | "in_progress" | "suspended" | "completed" | "expired" = "ready",
) {
  const attempts = createInMemoryExamAttemptRepository();
  await attempts.save({
    id: "ea-1",
    customerId: "customer-1",
    candidateId: "cand-1",
    examId: "exam-1",
    status,
    scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
  });
  return attempts;
}

async function makeAttemptsFor(
  examAttemptId: string,
  status: "ready" | "scheduled" | "in_progress" | "suspended" | "completed" | "expired",
) {
  const attempts = createInMemoryExamAttemptRepository();
  await attempts.save({
    id: examAttemptId,
    customerId: "customer-1",
    candidateId: "cand-1",
    examId: "exam-1",
    status,
    scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
  });
  return attempts;
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
    const attempts = await makeAttempts("in_progress");

    await suspendExam(
      { controller, source: fixedSource("suspended"), timer, attempts, launches: makeLaunches(), sleep: noSleep },
      { examAttemptId: "ea-1" },
    );

    expect(controller.suspended).toEqual(["ENVS-test-env-1"]);
    expect(timer.paused).toEqual(["ea-1"]);
    await expect(attempts.findById("ea-1")).resolves.toMatchObject({ status: "suspended" });
  });

  it("throws LabLaunchNotFoundError if no lab launch exists for the exam attempt", async () => {
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer: makeTimer(),
          attempts: await makeAttemptsFor("ea-missing", "in_progress"),
          launches: makeLaunches(null),
          sleep: noSleep,
        },
        { examAttemptId: "ea-missing" },
      ),
    ).rejects.toBeInstanceOf(LabLaunchNotFoundError);
  });

  it("LabLaunchNotFoundError is also a TimerSyncError (subtype check)", async () => {
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer: makeTimer(),
          attempts: await makeAttemptsFor("ea-missing", "in_progress"),
          launches: makeLaunches(null),
          sleep: noSleep,
        },
        { examAttemptId: "ea-missing" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("retries polling until the status reaches suspended", async () => {
    const timer = makeTimer();
    const attempts = await makeAttempts("in_progress");

    await suspendExam(
      {
        controller: makeController(),
        source: eventualSource("running", "suspended", 2),
        timer,
        attempts,
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
          attempts: await makeAttempts("in_progress"),
          launches: makeLaunches(),
          sleep: noSleep,
          poll: { maxAttempts: 3, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("throws TimerSyncError (timeout) when the state source returns null for all polls", async () => {
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: nullSource,
          timer: makeTimer(),
          attempts: await makeAttempts("in_progress"),
          launches: makeLaunches(),
          sleep: noSleep,
          poll: { maxAttempts: 2, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("does NOT pause the timer if polling fails", async () => {
    const timer = makeTimer();
    const attempts = await makeAttempts("in_progress");
    await expect(
      suspendExam(
        {
          controller: makeController(),
          source: fixedSource("running"),
          timer,
          attempts,
          launches: makeLaunches(),
          sleep: noSleep,
          poll: { maxAttempts: 1, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
    expect(timer.paused).toHaveLength(0);
  });

  it.each(["ready", "scheduled", "completed", "expired"] as const)(
    "rejects suspend when the attempt status is %s",
    async (status) => {
      const controller = makeController();
      const timer = makeTimer();
      const attempts = await makeAttempts(status);

      await expect(
        suspendExam(
          {
            controller,
            source: fixedSource("suspended"),
            timer,
            attempts,
            launches: makeLaunches(),
            sleep: noSleep,
          },
          { examAttemptId: "ea-1" },
        ),
      ).rejects.toBeInstanceOf(TimerSyncError);

      expect(controller.suspended).toHaveLength(0);
      expect(timer.paused).toHaveLength(0);
      await expect(attempts.findById("ea-1")).resolves.toMatchObject({ status });
    },
  );
});

// --- resumeExam ---

describe("resumeExam", () => {
  it("issues resume, polls until running, then resumes the timer without minting a new sponsored link", async () => {
    const controller = makeController();
    const timer = makeTimer();
    const attempts = await makeAttempts("suspended");
    const launches = makeLaunches();
    const labs = makeLabs("https://new.lab.url/login");

    const result = await resumeExam(
      {
        controller,
        source: fixedSource("running"),
        timer,
        attempts,
        launches,
        labs,
        sleep: noSleep,
      },
      { examAttemptId: "ea-1" },
    );

    expect(controller.resumed).toEqual(["ENVS-test-env-1"]);
    expect(timer.resumed).toEqual(["ea-1"]);
    expect(result.environmentExternalId).toBe("ENVS-test-env-1");
    expect(result.suspendedPreservationLimitMs).toBe(SUSPENDED_PRESERVATION_LIMIT_MS);
    expect(labs.createSponsoredLinkCalls).toBe(0);
    await expect(attempts.findById("ea-1")).resolves.toMatchObject({ status: "in_progress" });
    await expect(launches.findByExamAttemptId("ea-1")).resolves.toMatchObject({
      loginUrl: "https://old.lab.url/login",
    });
  });

  it("accepts CloudShare preparing state as a successful resume confirmation", async () => {
    const timer = makeTimer();
    const attempts = await makeAttempts("suspended");

    await resumeExam(
      {
        controller: makeController(),
        source: fixedSource("created"),
        timer,
        attempts,
        launches: makeLaunches(),
        labs: makeLabs(),
        sleep: noSleep,
      },
      { examAttemptId: "ea-1" },
    );

    expect(timer.resumed).toEqual(["ea-1"]);
    await expect(attempts.findById("ea-1")).resolves.toMatchObject({ status: "in_progress" });
  });

  it("throws LabLaunchNotFoundError if no lab launch exists for the exam attempt", async () => {
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: fixedSource("running"),
          timer: makeTimer(),
          attempts: await makeAttemptsFor("ea-missing", "suspended"),
          launches: makeLaunches(null),
          labs: makeLabs(),
          sleep: noSleep,
        },
        { examAttemptId: "ea-missing" },
      ),
    ).rejects.toBeInstanceOf(LabLaunchNotFoundError);
  });

  it("throws TimerSyncError if the environment never reaches running within maxAttempts", async () => {
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer: makeTimer(),
          attempts: await makeAttempts("suspended"),
          launches: makeLaunches(),
          labs: makeLabs(),
          sleep: noSleep,
          poll: { maxAttempts: 2, intervalMs: 0 },
        },
        { examAttemptId: "ea-1" },
      ),
    ).rejects.toBeInstanceOf(TimerSyncError);
  });

  it("throws TimerSyncError (timeout) when state source returns null for all polls", async () => {
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: nullSource,
          timer: makeTimer(),
          attempts: await makeAttempts("suspended"),
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
    const attempts = await makeAttempts("suspended");
    await expect(
      resumeExam(
        {
          controller: makeController(),
          source: fixedSource("suspended"),
          timer,
          attempts,
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

  it.each(["ready", "scheduled", "in_progress", "completed", "expired"] as const)(
    "rejects resume when the attempt status is %s",
    async (status) => {
      const controller = makeController();
      const timer = makeTimer();
      const attempts = await makeAttempts(status);
      const launches = makeLaunches();
      const labs = makeLabs("https://should-not-be-used.example");

      await expect(
        resumeExam(
          {
            controller,
            source: fixedSource("running"),
            timer,
            attempts,
            launches,
            labs,
            sleep: noSleep,
          },
          { examAttemptId: "ea-1" },
        ),
      ).rejects.toBeInstanceOf(TimerSyncError);

      expect(controller.resumed).toHaveLength(0);
      expect(timer.resumed).toHaveLength(0);
      await expect(attempts.findById("ea-1")).resolves.toMatchObject({ status });
      await expect(launches.findByExamAttemptId("ea-1")).resolves.toMatchObject({
        loginUrl: "https://old.lab.url/login",
      });
    },
  );
});
