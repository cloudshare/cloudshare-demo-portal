/**
 * Tests that candidate runtime actions (enter, suspend, resume, heartbeat auto-suspend)
 * emit typed DiagnosticLogEntry writes via the DiagnosticRecorder.
 */
import { describe, it, expect, vi } from "vitest";
import { createDiagnosticRecorder, type DiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { handleEnterExam, type EnterExamDeps } from "./enter";
import {
  handleSuspendExam,
  handleResumeExam,
  runHeartbeatAutoSuspend,
  type SuspendHandlerDeps,
  type ResumeHandlerDeps,
  type HeartbeatAutoSuspendHandlerDeps,
} from "./suspend-resume";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { EventLogRepository } from "@/domain/event-log";
import type { Logger } from "@/observability/logger";
import type { EnvironmentController } from "@/domain/timer-sync";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import { CloudShareRequestError } from "@/integrations/cloudshare";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

function diagnosticsHarness(): {
  repository: ReturnType<typeof createInMemoryDiagnosticLogRepository>;
  recorder: DiagnosticRecorder;
} {
  const repository = createInMemoryDiagnosticLogRepository();
  const recorder = createDiagnosticRecorder({ repository });
  return { repository, recorder };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeEventLog(): EventLogRepository {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    listAll: vi.fn().mockResolvedValue([]),
  };
}

function makeController(): EnvironmentController {
  return {
    suspendEnvironment: vi.fn().mockResolvedValue(undefined),
    resumeEnvironment: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSource(status: string): EnvironmentStateSource {
  return {
    getEnvironmentState: (id) =>
      Promise.resolve({ environmentExternalId: id, status: status as never }),
  };
}

const BASE_ATTEMPT: ExamAttempt = {
  id: "ea-1",
  customerId: "customer-1",
  candidateId: "cand-1",
  examId: "exam-1",
  status: "ready" as const,
  scheduledFor: new Date("2026-06-15T09:00:00.000Z"),
  createdAt: new Date("2026-06-15T08:00:00.000Z"),
};

const BASE_LAUNCH = {
  id: "launch-1",
  examAttemptId: "ea-1",
  candidateId: "cand-1",
  participantEmail: "candidate@helioscx.demo",
  trainingId: "EXtraining-1",
  experienceId: "exp-1",
  environmentExternalId: "ENVS-env-1",
  loginUrl: "https://lab.cloudshare.com/enter?token=secret",
  status: "launched" as const,
  createdAt: new Date(),
};

function makeAttempts(attempt: ExamAttempt | null = BASE_ATTEMPT): ExamAttemptRepository {
  const repo = createInMemoryExamAttemptRepository();
  if (attempt) {
    void repo.save(attempt);
  }
  return repo;
}

function makeLaunches(found = BASE_LAUNCH): LabLaunchRepository {
  const repo = createInMemoryLabLaunchRepository();
  if (found) {
    void repo.save(found);
  }
  return repo;
}

function makeConnections(): CloudShareConnectionRepository {
  return {
    save: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue({
      customerId: "customer-1",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
      webhookPathToken: "whk-customer-1",
      connectedAt: new Date(),
      verifiedAt: new Date(),
    }),
    findByWebhookPathToken: vi.fn(),
    markVerified: vi.fn(),
  };
}

function makeSuspendCloudShareFactory(): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(v: unknown): unknown } }) => {
        if (spec.path === "/envs/actions/suspend") return spec.schema.parse({});
        if (spec.path.startsWith("/envs/")) return spec.schema.parse({ envStatus: "Suspended" });
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as never,
      requestV3Text: vi.fn().mockResolvedValue(""),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(v: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS-env-1",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as never,
    }),
  };
}

function makeResumeCloudShareFactory(): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(v: unknown): unknown } }) => {
        if (spec.path === "/envs/actions/resume") return spec.schema.parse({});
        if (spec.path.startsWith("/envs/")) return spec.schema.parse({ envStatus: "Running" });
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as never,
      requestV3Text: vi.fn().mockResolvedValue(""),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(v: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS-env-1",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as never,
    }),
  };
}

function makeFailingCloudShareFactory(): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3: vi.fn().mockRejectedValue(
        new CloudShareRequestError("Bad Gateway", 502, {
          integrationSurface: "cloudshare.v3.env.action.suspend",
          method: "PUT",
          path: "/api/v3/envs/actions/suspend",
          environmentExternalId: "ENVS-env-1",
        }),
      ) as never,
      requestV3Text: vi.fn().mockResolvedValue(""),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(v: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS-env-1",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as never,
    }),
  };
}

// ---------------------------------------------------------------------------
// handleEnterExam diagnostics
// ---------------------------------------------------------------------------

describe("handleEnterExam diagnostics", () => {
  it("emits exam_attempt.enter success with trainingId in externalIds and no loginUrl", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const now = () => new Date("2026-06-15T10:00:00.000Z"); // after scheduledFor

    const deps: EnterExamDeps = {
      attempts: makeAttempts(),
      launches: makeLaunches(),
      logger: makeLogger(),
      now,
      diagnostics: recorder,
      candidateEmail: "candidate@helioscx.demo",
      timer: { pauseTimer: vi.fn(), resumeTimer: vi.fn().mockResolvedValue(undefined) },
    };

    const resp = await handleEnterExam(deps, { examAttemptId: "ea-1", candidateId: "cand-1" });
    expect(resp.status).toBe(302);

    const entries = await repository.query({ examAttemptId: "ea-1" });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toMatchObject({
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "success",
      examAttemptId: "ea-1",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
      actor: { type: "candidate", id: "cand-1" },
    });
    expect(entry.externalIds).toMatchObject({ trainingId: "EXtraining-1" });
    // loginUrl must not appear anywhere in the serialised entry
    expect(JSON.stringify(entry)).not.toContain("token=secret");
    expect(JSON.stringify(entry)).not.toContain("loginUrl");
  });

  it("emits exam_attempt.enter failure when attempt status is not enterable", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const now = () => new Date("2026-06-15T10:00:00.000Z");

    const completedAttempt: ExamAttempt = { ...BASE_ATTEMPT, status: "completed" };
    const attempts = makeAttempts(completedAttempt);

    const deps: EnterExamDeps = {
      attempts,
      launches: makeLaunches(),
      logger: makeLogger(),
      now,
      diagnostics: recorder,
      candidateEmail: "candidate@helioscx.demo",
    };

    const resp = await handleEnterExam(deps, { examAttemptId: "ea-1", candidateId: "cand-1" });
    expect(resp.status).toBe(403);

    const entries = await repository.query({ examAttemptId: "ea-1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "failure",
      examAttemptId: "ea-1",
      details: { attemptStatus: "completed" },
    });
  });
});

// ---------------------------------------------------------------------------
// handleSuspendExam diagnostics
// ---------------------------------------------------------------------------

describe("handleSuspendExam diagnostics", () => {
  it("emits exam_attempt.suspend success", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const attempts = makeAttempts({ ...BASE_ATTEMPT, status: "in_progress" });
    const launches = makeLaunches();
    const cloudshare = makeSuspendCloudShareFactory();

    const deps: SuspendHandlerDeps = {
      attempts,
      launches,
      connections: makeConnections(),
      cloudshare,
      controller: makeController(),
      source: makeSource("Suspended"),
      timer: { pauseTimer: vi.fn().mockResolvedValue(undefined), resumeTimer: vi.fn() },
      sleep: () => Promise.resolve(),
      logger: makeLogger(),
      eventLog: makeEventLog(),
      diagnostics: recorder,
      candidateEmail: "candidate@helioscx.demo",
    };

    const resp = await handleSuspendExam(deps, { body: { examAttemptId: "ea-1" } });
    expect(resp.status).toBe(200);

    const entries = await repository.query({ examAttemptId: "ea-1" });
    expect(entries.some((e) => e.operation === "exam_attempt.suspend" && e.outcome === "success")).toBe(true);
    const entry = entries.find((e) => e.operation === "exam_attempt.suspend")!;
    expect(entry).toMatchObject({
      source: "runtime",
      outcome: "success",
      examAttemptId: "ea-1",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
    });
  });

  it("emits exam_attempt.suspend failure on CloudShare error", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const attempts = makeAttempts({ ...BASE_ATTEMPT, status: "in_progress" });
    const launches = makeLaunches();
    const cloudshare = makeFailingCloudShareFactory();

    const deps: SuspendHandlerDeps = {
      attempts,
      launches,
      connections: makeConnections(),
      cloudshare,
      controller: makeController(),
      source: makeSource("Running"),
      timer: { pauseTimer: vi.fn().mockResolvedValue(undefined), resumeTimer: vi.fn() },
      sleep: () => Promise.resolve(),
      logger: makeLogger(),
      eventLog: makeEventLog(),
      diagnostics: recorder,
      candidateEmail: "candidate@helioscx.demo",
    };

    const resp = await handleSuspendExam(deps, { body: { examAttemptId: "ea-1" } });
    expect(resp.status).not.toBe(200);

    const entries = await repository.query({ examAttemptId: "ea-1" });
    const failure = entries.find((e) => e.operation === "exam_attempt.suspend" && e.outcome === "failure");
    expect(failure).toBeDefined();
    expect(failure).toMatchObject({
      source: "runtime",
      outcome: "failure",
      examAttemptId: "ea-1",
    });
  });
});

// ---------------------------------------------------------------------------
// handleResumeExam diagnostics
// ---------------------------------------------------------------------------

describe("handleResumeExam diagnostics", () => {
  it("emits exam_attempt.resume success", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const attempts = makeAttempts({ ...BASE_ATTEMPT, status: "suspended" });
    const launches = makeLaunches();
    const cloudshare = makeResumeCloudShareFactory();

    const deps: ResumeHandlerDeps = {
      attempts,
      launches,
      connections: makeConnections(),
      cloudshare,
      controller: makeController(),
      source: makeSource("Running"),
      timer: { pauseTimer: vi.fn(), resumeTimer: vi.fn().mockResolvedValue(undefined) },
      labs: {
        createExperience: vi.fn(),
        addStudent: vi.fn(),
        createSponsoredLink: vi.fn().mockResolvedValue({ loginUrl: "https://new.lab.url" }),
      },
      sleep: () => Promise.resolve(),
      logger: makeLogger(),
      eventLog: makeEventLog(),
      diagnostics: recorder,
      candidateEmail: "candidate@helioscx.demo",
    };

    const resp = await handleResumeExam(deps, { body: { examAttemptId: "ea-1" } });
    expect(resp.status).toBe(200);

    const entries = await repository.query({ examAttemptId: "ea-1" });
    const success = entries.find((e) => e.operation === "exam_attempt.resume" && e.outcome === "success");
    expect(success).toBeDefined();
    expect(success).toMatchObject({
      source: "runtime",
      examAttemptId: "ea-1",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
    });
  });
});

// ---------------------------------------------------------------------------
// runHeartbeatAutoSuspend diagnostics
// ---------------------------------------------------------------------------

describe("runHeartbeatAutoSuspend diagnostics", () => {
  it("emits exam_attempt.heartbeat_auto_suspend success", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const attempts = makeAttempts({ ...BASE_ATTEMPT, status: "in_progress" });
    const launches = makeLaunches();
    const cloudshare = makeSuspendCloudShareFactory();

    const deps: HeartbeatAutoSuspendHandlerDeps = {
      attempts,
      launches,
      connections: makeConnections(),
      cloudshare,
      controller: makeController(),
      source: makeSource("Suspended"),
      timer: { pauseTimer: vi.fn().mockResolvedValue(undefined), resumeTimer: vi.fn() },
      sleep: () => Promise.resolve(),
      logger: makeLogger(),
      eventLog: makeEventLog(),
      diagnostics: recorder,
      candidateEmail: undefined,
    };

    await runHeartbeatAutoSuspend(deps, "ea-1");

    const entries = await repository.query({ examAttemptId: "ea-1" });
    const entry = entries.find((e) => e.operation === "exam_attempt.heartbeat_auto_suspend" && e.outcome === "success");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      source: "runtime",
      outcome: "success",
      examAttemptId: "ea-1",
      customerId: "customer-1",
    });
  });
});
