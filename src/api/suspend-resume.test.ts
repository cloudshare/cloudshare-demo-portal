import { describe, it, expect, vi } from "vitest";
import { handleSuspendExam, handleResumeExam } from "./suspend-resume";
import type { SuspendHandlerDeps, ResumeHandlerDeps } from "./suspend-resume";
import type { ExamTimer, EnvironmentController } from "@/domain/timer-sync";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { LabLaunchRepository, LabProvisioner } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";

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

async function makeAttempts(status: "ready" | "in_progress" | "suspended" = "ready") {
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

async function makeSuspendDeps(overrides: Partial<SuspendHandlerDeps> = {}): Promise<SuspendHandlerDeps> {
  return {
    controller: makeController(),
    source: fixedSource("suspended"),
    timer: makeTimer(),
    attempts: await makeAttempts("in_progress"),
    launches: makeLaunches(),
    sleep: noSleep,
    logger,
    ...overrides,
  };
}

async function makeResumeDeps(overrides: Partial<ResumeHandlerDeps> = {}): Promise<ResumeHandlerDeps> {
  return {
    controller: makeController(),
    source: fixedSource("running"),
    timer: makeTimer(),
    attempts: await makeAttempts("suspended"),
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
    const resp = await handleSuspendExam(await makeSuspendDeps(), { body: null });
    expect(resp.status).toBe(400);
  });

  it("returns 400 if examAttemptId is missing", async () => {
    const resp = await handleSuspendExam(await makeSuspendDeps(), { body: {} });
    expect(resp.status).toBe(400);
  });

  it("returns 400 if examAttemptId is an empty string", async () => {
    const resp = await handleSuspendExam(await makeSuspendDeps(), { body: { examAttemptId: "  " } });
    expect(resp.status).toBe(400);
  });

  it("returns 200 and status=suspended on success", async () => {
    const resp = await handleSuspendExam(
      await makeSuspendDeps(),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("suspended");
    expect(resp.body.examAttemptId).toBe("ea-1");
  });

  it("returns 404 when no launch exists for the exam attempt", async () => {
    const resp = await handleSuspendExam(
      await makeSuspendDeps({ launches: makeLaunches(null) }),
      { body: { examAttemptId: "ea-missing" } },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out (TimerSyncError, not a not-found)", async () => {
    const resp = await handleSuspendExam(
      await makeSuspendDeps({
        source: fixedSource("running"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
  });

  it("returns 500 on an unexpected error", async () => {
    const resp = await handleSuspendExam(
      await makeSuspendDeps({
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
    const resp = await handleResumeExam(await makeResumeDeps(), { body: "bad" });
    expect(resp.status).toBe(400);
  });

  it("returns 400 if examAttemptId is an empty string", async () => {
    const resp = await handleResumeExam(await makeResumeDeps(), { body: { examAttemptId: "" } });
    expect(resp.status).toBe(400);
  });

  it("returns 200 without loginUrl and with preservation limit on success", async () => {
    const resp = await handleResumeExam(
      await makeResumeDeps({ labs: makeLabs("https://new.lab.url") }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("resumed");
    expect(resp.body).not.toHaveProperty("loginUrl");
    expect(typeof resp.body.suspendedPreservationLimitMs).toBe("number");
    expect(JSON.stringify(resp.body)).not.toContain("loginUrl");
  });

  it("returns 404 when no launch exists", async () => {
    const resp = await handleResumeExam(
      await makeResumeDeps({ launches: makeLaunches(null) }),
      { body: { examAttemptId: "ea-missing" } },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out", async () => {
    const resp = await handleResumeExam(
      await makeResumeDeps({
        source: fixedSource("suspended"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
  });

  it("returns 500 on an unexpected error", async () => {
    const resp = await handleResumeExam(
      await makeResumeDeps({
        controller: {
          suspendEnvironment: () => Promise.resolve(),
          resumeEnvironment: () => Promise.reject(new Error("boom")),
        },
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(500);
  });
});
