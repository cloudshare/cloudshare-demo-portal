import { describe, it, expect, vi } from "vitest";
import { handleSuspendExam, handleResumeExam } from "./suspend-resume";
import type { SuspendHandlerDeps, ResumeHandlerDeps } from "./suspend-resume";
import type { ExamTimer, EnvironmentController } from "@/domain/timer-sync";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { LabLaunchRepository, LabProvisioner } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import { TimerSyncError } from "@/domain/errors";

const noSleep = () => Promise.resolve();

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const launch = {
  id: "launch-1",
  examAttemptId: "ea-1",
  candidateId: "cand-1",
  experienceId: "exp-1",
  environmentExternalId: "env-1",
  loginUrl: "https://old.lab.url",
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

function makeTimer(): ExamTimer {
  return {
    pauseTimer: () => Promise.resolve(),
    resumeTimer: () => Promise.resolve(),
  };
}

function makeController(): EnvironmentController {
  return {
    suspendEnvironment: () => Promise.resolve(),
    resumeEnvironment: () => Promise.resolve(),
  };
}

function fixedSource(status: string): EnvironmentStateSource {
  return {
    getEnvironmentState: (id) =>
      Promise.resolve({ environmentExternalId: id, status: status as never }),
  };
}

function makeLabs(loginUrl = "https://new.lab.url"): LabProvisioner {
  return {
    createExperience: () => Promise.resolve({ experienceId: "exp-1" }),
    addStudent: () => Promise.resolve(),
    createSponsoredLink: () => Promise.resolve({ loginUrl }),
  };
}

function makeSuspendDeps(overrides: Partial<SuspendHandlerDeps> = {}): SuspendHandlerDeps {
  return {
    controller: makeController(),
    source: fixedSource("suspended"),
    timer: makeTimer(),
    launches: makeLaunches(),
    sleep: noSleep,
    logger,
    ...overrides,
  };
}

function makeResumeDeps(overrides: Partial<ResumeHandlerDeps> = {}): ResumeHandlerDeps {
  return {
    controller: makeController(),
    source: fixedSource("running"),
    timer: makeTimer(),
    launches: makeLaunches(),
    labs: makeLabs(),
    sleep: noSleep,
    logger,
    ...overrides,
  };
}

// --- handleSuspendExam ---

describe("handleSuspendExam", () => {
  it("returns 400 if body is not an object", async () => {
    const resp = await handleSuspendExam(makeSuspendDeps(), { body: null });
    expect(resp.status).toBe(400);
  });

  it("returns 400 if examAttemptId is missing", async () => {
    const resp = await handleSuspendExam(makeSuspendDeps(), { body: {} });
    expect(resp.status).toBe(400);
  });

  it("returns 202 and status=suspended on success", async () => {
    const resp = await handleSuspendExam(
      makeSuspendDeps(),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(202);
    expect(resp.body.status).toBe("suspended");
    expect(resp.body.examAttemptId).toBe("ea-1");
  });

  it("returns 404 when no launch exists for the exam attempt", async () => {
    const resp = await handleSuspendExam(
      makeSuspendDeps({ launches: makeLaunches(null) }),
      { body: { examAttemptId: "ea-missing" } },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out (TimerSyncError not a not-found)", async () => {
    const resp = await handleSuspendExam(
      makeSuspendDeps({
        source: fixedSource("running"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
  });

  it("returns 500 on an unexpected error", async () => {
    const resp = await handleSuspendExam(
      makeSuspendDeps({
        controller: {
          suspendEnvironment: () => Promise.reject(new Error("unexpected")),
          resumeEnvironment: () => Promise.resolve(),
        },
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(500);
  });
});

// --- handleResumeExam ---

describe("handleResumeExam", () => {
  it("returns 400 if body is not an object", async () => {
    const resp = await handleResumeExam(makeResumeDeps(), { body: "bad" });
    expect(resp.status).toBe(400);
  });

  it("returns 202 with loginUrl and preservation limit on success", async () => {
    const newUrl = "https://new.lab.url";
    const resp = await handleResumeExam(
      makeResumeDeps({ labs: makeLabs(newUrl) }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(202);
    expect(resp.body.status).toBe("resumed");
    expect(resp.body.loginUrl).toBe(newUrl);
    expect(typeof resp.body.suspendedPreservationLimitMs).toBe("number");
  });

  it("returns 404 when no launch exists", async () => {
    const resp = await handleResumeExam(
      makeResumeDeps({ launches: makeLaunches(null) }),
      { body: { examAttemptId: "ea-missing" } },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out", async () => {
    const resp = await handleResumeExam(
      makeResumeDeps({
        source: fixedSource("suspended"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
  });
});
