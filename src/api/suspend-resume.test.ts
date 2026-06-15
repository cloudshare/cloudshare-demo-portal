import { describe, it, expect, vi } from "vitest";
import {
  handleSuspendExam,
  handleResumeExam,
  runHeartbeatAutoSuspend,
} from "./suspend-resume";
import type { SuspendHandlerDeps, ResumeHandlerDeps } from "./suspend-resume";
import type { ExamTimer, EnvironmentController } from "@/domain/timer-sync";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { LabLaunchRepository, LabProvisioner } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";

const noSleep = () => Promise.resolve();

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

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

async function makeSuspendDeps(overrides: Partial<SuspendHandlerDeps> = {}): Promise<SuspendHandlerDeps> {
  return {
    controller: makeController(),
    source: fixedSource("suspended"),
    timer: makeTimer(),
    attempts: await makeAttempts("in_progress"),
    launches: makeLaunches(),
    sleep: noSleep,
    logger: makeLogger(),
    eventLog: { append: vi.fn().mockResolvedValue(undefined), listAll: vi.fn() },
    newCorrelationId: () => "corr-suspend",
    now: () => new Date("2026-06-15T10:10:00.000Z"),
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
    logger: makeLogger(),
    eventLog: { append: vi.fn().mockResolvedValue(undefined), listAll: vi.fn() },
    newCorrelationId: () => "corr-resume",
    now: () => new Date("2026-06-15T10:10:00.000Z"),
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
      await makeSuspendDeps({
        attempts: await makeAttemptsFor("ea-missing", "in_progress"),
        launches: makeLaunches(null),
      }),
      { body: { examAttemptId: "ea-missing" } },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out (TimerSyncError, not a not-found)", async () => {
    const deps = await makeSuspendDeps({
        source: fixedSource("running"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      });
    const resp = await handleSuspendExam(
      deps,
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toMatchObject({ error: "exam suspend failed", correlationId: "corr-suspend" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.exam_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "exam_suspend",
          attemptedOperation: "poll_environment_status",
          integrationSurface: "cloudshare.v3.environment",
          method: "GET",
          failureMode: "confirmation_timeout",
        }),
      }),
    );
  });

  it("returns 409 when suspend is requested outside the in_progress state", async () => {
    const resp = await handleSuspendExam(
      await makeSuspendDeps({
        attempts: await makeAttempts("ready"),
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(409);
    expect(resp.body).toMatchObject({
      error: "Exam attempt is not in a valid status for this transition",
      expectedStatus: "in_progress",
      currentStatus: "ready",
    });
  });

  it("returns 502 with supportable diagnostics when CloudShare suspend returns an http status error", async () => {
    const deps = await makeSuspendDeps({
        controller: {
          suspendEnvironment: () =>
            Promise.reject(
              new CloudShareRequestError("forbidden", 403, {
                integrationSurface: "cloudshare.v4.environment.action.suspend",
                method: "POST",
                path: "/v4/environments/env-1/actions/suspend",
                responseBody: "{\"error\":\"forbidden\"}",
              }),
            ),
          resumeEnvironment: () => Promise.resolve(),
        },
      });
    const resp = await handleSuspendExam(
      deps,
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam suspend failed", correlationId: "corr-suspend" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          attemptedOperation: "suspend_environment",
          integrationSurface: "cloudshare.v4.environment.action.suspend",
          method: "POST",
          path: "/v4/environments/env-1/actions/suspend",
          failureMode: "http_status",
          responseStatus: 403,
          responseBody: "{\"error\":\"forbidden\"}",
        }),
      }),
    );
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
    expect(resp.body).toEqual({ error: "internal error", correlationId: "corr-suspend" });
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
      await makeResumeDeps({
        attempts: await makeAttemptsFor("ea-missing", "suspended"),
        launches: makeLaunches(null),
      }),
      { body: { examAttemptId: "ea-missing" } },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out", async () => {
    const deps = await makeResumeDeps({
        source: fixedSource("suspended"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      });
    const resp = await handleResumeExam(
      deps,
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-resume",
        payload: expect.objectContaining({
          correlationId: "corr-resume",
          attemptedOperation: "poll_environment_status",
          integrationSurface: "cloudshare.v3.environment",
          failureMode: "confirmation_timeout",
        }),
      }),
    );
  });

  it("returns 409 when resume is requested outside the suspended state", async () => {
    const resp = await handleResumeExam(
      await makeResumeDeps({
        attempts: await makeAttempts("in_progress"),
      }),
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(409);
    expect(resp.body).toMatchObject({
      error: "Exam attempt is not in a valid status for this transition",
      expectedStatus: "suspended",
      currentStatus: "in_progress",
    });
  });

  it("returns 502 with transport diagnostics when CloudShare resume transport fails", async () => {
    const deps = await makeResumeDeps({
      controller: {
        suspendEnvironment: () => Promise.resolve(),
        resumeEnvironment: () =>
          Promise.reject(
            new CloudShareTransportError("network down", {
              integrationSurface: "cloudshare.v4.environment.action.resume",
              method: "POST",
              path: "/v4/environments/env-1/actions/resume",
              cause: "ECONNRESET",
            }),
          ),
      },
    });
    const resp = await handleResumeExam(
      deps,
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v4.environment.action.resume",
          method: "POST",
          path: "/v4/environments/env-1/actions/resume",
          failureMode: "transport",
          cause: "ECONNRESET",
        }),
      }),
    );
  });

  it("returns 502 with response-shape diagnostics when CloudShare resume returns an unexpected payload", async () => {
    const deps = await makeResumeDeps({
      controller: {
        suspendEnvironment: () => Promise.resolve(),
        resumeEnvironment: () =>
          Promise.reject(
            new CloudShareResponseError("schema mismatch", {
              integrationSurface: "cloudshare.v4.environment.action.resume",
              method: "POST",
              path: "/v4/environments/env-1/actions/resume",
              responseBody: "{\"bad\":true}",
              issues: ["Required"],
            }),
          ),
      },
    });
    const resp = await handleResumeExam(
      deps,
      { body: { examAttemptId: "ea-1" } },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v4.environment.action.resume",
          failureMode: "unexpected_response",
          responseBody: "{\"bad\":true}",
          issues: ["Required"],
        }),
      }),
    );
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
    expect(resp.body).toEqual({ error: "internal error", correlationId: "corr-resume" });
  });
});

describe("runHeartbeatAutoSuspend", () => {
  it.each([
    [
      "CloudShareRequestError",
      new CloudShareRequestError("forbidden", 403, {
        integrationSurface: "cloudshare.v4.environment.action.suspend",
        method: "POST",
        path: "/v4/environments/env-1/actions/suspend",
        responseBody: "{\"error\":\"forbidden\"}",
      }),
      expect.objectContaining({
        operation: "heartbeat_auto_suspend",
        attemptedOperation: "suspend_environment",
        integrationSurface: "cloudshare.v4.environment.action.suspend",
        method: "POST",
        path: "/v4/environments/env-1/actions/suspend",
        failureMode: "http_status",
        responseStatus: 403,
        responseBody: "{\"error\":\"forbidden\"}",
      }),
    ],
    [
      "CloudShareResponseError",
      new CloudShareResponseError("schema mismatch", {
        integrationSurface: "cloudshare.v4.environment.action.suspend",
        method: "POST",
        path: "/v4/environments/env-1/actions/suspend",
        responseBody: "{\"bad\":true}",
        issues: ["Required"],
      }),
      expect.objectContaining({
        operation: "heartbeat_auto_suspend",
        attemptedOperation: "suspend_environment",
        integrationSurface: "cloudshare.v4.environment.action.suspend",
        method: "POST",
        path: "/v4/environments/env-1/actions/suspend",
        failureMode: "unexpected_response",
        responseBody: "{\"bad\":true}",
        issues: ["Required"],
      }),
    ],
  ])(
    "appends an admin-visible diagnostic and rethrows on %s",
    async (_label, error, expectedPayload) => {
      const deps = await makeSuspendDeps({
        controller: {
          suspendEnvironment: () => Promise.reject(error),
          resumeEnvironment: () => Promise.resolve(),
        },
      });

      await expect(runHeartbeatAutoSuspend(deps, "ea-1")).rejects.toBe(error);
      expect(deps.eventLog.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "corr-suspend",
          type: "cloudshare.heartbeat_auto_suspend.failed",
          payload: expectedPayload,
        }),
      );
      expect(deps.logger.warn).toHaveBeenCalledWith(
        "heartbeat auto-suspend failed",
        expectedPayload,
      );
    },
  );

  it("appends a timeout diagnostic and rethrows when confirmation polling never reaches suspended", async () => {
    const deps = await makeSuspendDeps({
      source: fixedSource("running"),
      poll: { maxAttempts: 1, intervalMs: 0 },
    });

    await expect(runHeartbeatAutoSuspend(deps, "ea-1")).rejects.toMatchObject({
      message: "Timed out waiting for environment to become suspended",
    });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.heartbeat_auto_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "heartbeat_auto_suspend",
          attemptedOperation: "poll_environment_status",
          integrationSurface: "cloudshare.v3.environment",
          method: "GET",
          failureMode: "confirmation_timeout",
        }),
      }),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "heartbeat auto-suspend failed",
      expect.objectContaining({
        correlationId: "corr-suspend",
        operation: "heartbeat_auto_suspend",
        attemptedOperation: "poll_environment_status",
        failureMode: "confirmation_timeout",
      }),
    );
  });
});
