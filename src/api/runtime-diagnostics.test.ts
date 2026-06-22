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
import { handleGetCandidateScore, type ScoreHandlerDeps } from "./score";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { EventLogRepository } from "@/domain/event-log";
import type { Logger } from "@/observability/logger";
import type { EnvironmentController } from "@/domain/timer-sync";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { ExamRepository, Exam } from "@/domain/exam-catalog";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticScoreRetrievalProvider, ScoreRetrievalProvider } from "@/domain/score-result";
import type { ParticipantLister } from "@/domain/environment-correlation";
import type { CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { CloudShareRequestError, CloudShareResponseError } from "@/integrations/cloudshare";
import { ScoreRetrievalError } from "@/domain/errors";
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
    listFailureEventsByExamAttemptIds: vi.fn().mockResolvedValue([]),
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

  it("emits exam_attempt.resume success with support metadata when the resume recovers after CloudShare reports an already-active environment", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const attempts = makeAttempts({ ...BASE_ATTEMPT, status: "suspended" });
    const launches = makeLaunches();
    const cloudshare: CloudShareClientFactory = {
      forConnection: () => ({
        requestV3: vi.fn(async (spec: { path: string; schema: { parse(v: unknown): unknown } }) => {
          if (spec.path.startsWith("/envs/")) {
            return spec.schema.parse({ envStatus: "Running" });
          }
          throw new Error(`unexpected v3 path ${spec.path}`);
        }) as never,
        requestV3Text: vi.fn(async () => {
          throw new CloudShareRequestError("already resumed", 409, {
            integrationSurface: "cloudshare.v3.env.action.resume",
            method: "PUT",
            path: "/api/v3/envs/actions/resume",
            environmentExternalId: "ENVS-env-1",
          });
        }) as never,
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
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
      examId: "exam-1",
      examAttemptId: "ea-1",
      externalIds: {
        environmentId: "ENVS-env-1",
        trainingId: "EXtraining-1",
        experienceId: "exp-1",
      },
      details: {
        idempotent: true,
        resumeDisposition: "already_active",
        recoveryReason: "cloudshare_reported_already_active",
        environmentStatus: "running",
      },
    });
  });

  it("emits exam_attempt.resume failure with customer scope and CloudShare support details", async () => {
    const { repository, recorder } = diagnosticsHarness();
    const attempts = makeAttempts({ ...BASE_ATTEMPT, status: "suspended" });
    const launches = makeLaunches();
    const cloudshare: CloudShareClientFactory = {
      forConnection: () => ({
        requestV3: vi.fn() as never,
        requestV3Text: vi.fn(async () => {
          throw new CloudShareRequestError("Bad Gateway", 502, {
            integrationSurface: "cloudshare.v3.env.action.resume",
            method: "PUT",
            path: "/api/v3/envs/actions/resume",
            environmentExternalId: "ENVS-env-1",
          });
        }) as never,
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
    expect(resp.status).toBe(502);

    const entries = await repository.query({ examAttemptId: "ea-1" });
    const failure = entries.find((e) => e.operation === "exam_attempt.resume" && e.outcome === "failure");
    expect(failure).toBeDefined();
    expect(failure).toMatchObject({
      source: "runtime",
      outcome: "failure",
      examAttemptId: "ea-1",
      examId: "exam-1",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
    });
    expect(failure?.details).toMatchObject({
      method: "PUT",
      path: "/api/v3/envs/actions/resume",
      integrationSurface: "cloudshare.v3.env.action.resume",
      responseStatus: 502,
      failureMode: "http_status",
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

// ---------------------------------------------------------------------------
// handleGetCandidateScore diagnostics
// ---------------------------------------------------------------------------

const SCORE_ATTEMPT: ExamAttempt = {
  id: "sa-1",
  customerId: "customer-1",
  candidateId: "cand-1",
  examId: "exam-1",
  status: "completed" as const,
  scheduledFor: new Date("2026-06-15T09:00:00.000Z"),
  createdAt: new Date("2026-06-15T08:00:00.000Z"),
};

const SCORE_EXAM: Exam = {
  id: "exam-1",
  customerId: "customer-1",
  title: "Test Exam",
  description: "desc",
  timeLimitMinutes: 60,
  scoreRetrievalEnabled: true,
  status: "published",
  publishedAt: new Date("2026-06-15T07:00:00.000Z"),
  createdAt: new Date("2026-06-15T07:00:00.000Z"),
  updatedAt: new Date("2026-06-15T07:00:00.000Z"),
  projectId: "proj-1",
  projectName: "Project 1",
  blueprintId: "bp-1",
  blueprintName: "Blueprint 1",
  snapshotId: "snap-1",
  snapshotName: "Snapshot 1",
  allowedRegions: [{ id: "region-1", name: "EU West" }],
  policyId: "policy-1",
  policyName: "Policy 1",
  instructorId: "instructor-1",
  instructorName: "Instructor 1",
};

const SCORE_LAUNCH = {
  id: "launch-s1",
  examAttemptId: "sa-1",
  candidateId: "cand-1",
  participantEmail: "candidate@helioscx.demo",
  participantId: "student-1",
  trainingId: "EXtraining-s1",
  experienceId: "exp-s1",
  environmentExternalId: "ENVS-env-s1",
  loginUrl: "https://lab.cloudshare.com/enter?token=secret2",
  status: "launched" as const,
  createdAt: new Date(),
};

const SCORE_CONNECTION: CloudShareConnectionRecord = {
  customerId: "customer-1",
  apiId: "api-id",
  apiKey: "api-key",
  webhookSecret: "whsec",
  webhookPathToken: "whk-customer-1",
  connectedAt: new Date(),
  verifiedAt: new Date(),
};

function makeScoreDeps(overrides: {
  scoreRetriever?: ScoreRetrievalProvider | DiagnosticScoreRetrievalProvider;
  participantLister?: ParticipantLister;
} = {}): ScoreHandlerDeps & { _recorder: DiagnosticRecorder; _repository: ReturnType<typeof createInMemoryDiagnosticLogRepository> } {
  const { repository, recorder } = diagnosticsHarness();

  const attempts = createInMemoryExamAttemptRepository();
  void attempts.save(SCORE_ATTEMPT);

  const launches = createInMemoryLabLaunchRepository();
  void launches.save(SCORE_LAUNCH);

  const exams: ExamRepository = {
    save: vi.fn(),
    findById: vi.fn().mockResolvedValue(SCORE_EXAM),
    listByCustomerId: vi.fn().mockResolvedValue([]),
  };

  const audit: AuditRepository = {
    write: vi.fn().mockResolvedValue(undefined),
    listByExamAttemptId: vi.fn().mockResolvedValue([]),
    listByExamAttemptIds: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([]),
  };

  const connections: CloudShareConnectionRepository = {
    save: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue(SCORE_CONNECTION),
    findByWebhookPathToken: vi.fn(),
    markVerified: vi.fn(),
  };

  const defaultScoreRetriever: ScoreRetrievalProvider = {
    getParticipantProgress: vi.fn().mockResolvedValue({
      percentComplete: 80,
      stepsCompleted: 4,
      stepsTotal: 5,
      steps: [],
      exploredRate: 0,
      inProgressRate: 0,
      notStartedRate: 0.2,
      passedRate: 0.8,
      failedRate: 0,
      notInitiatedRate: 0,
    }),
  };

  const defaultParticipantLister: ParticipantLister = {
    listParticipants: vi.fn().mockResolvedValue([
      { email: "candidate@helioscx.demo", environmentId: "ENVS-env-s1", environmentStatus: "ready", studentId: "student-1" },
    ]),
  };

  return {
    attempts,
    launches,
    exams,
    audit,
    connections,
    createScoreRetriever: vi.fn().mockReturnValue(overrides.scoreRetriever ?? defaultScoreRetriever),
    createParticipantLister: vi.fn().mockReturnValue(overrides.participantLister ?? defaultParticipantLister),
    logger: makeLogger(),
    limitations: [],
    now: () => new Date("2026-06-15T10:00:00.000Z"),
    newCorrelationId: () => "score-corr-1",
    diagnostics: recorder,
    _recorder: recorder,
    _repository: repository,
  };
}

const SCORE_SESSION = {
  userId: "cand-1",
  customerId: "customer-1",
  role: "candidate" as const,
};

describe("score diagnostics", () => {
  it("emits exam_attempt.score.correlate_environment success when participant ID is already present", async () => {
    const deps = makeScoreDeps();

    const resp = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "sa-1" },
      session: SCORE_SESSION,
    });
    expect(resp.status).toBe(200);

    const entries = await deps._repository.query({ examAttemptId: "sa-1" });
    const correlate = entries.find((e) => e.operation === "exam_attempt.score.correlate_environment");
    expect(correlate).toBeDefined();
    expect(correlate).toMatchObject({
      source: "runtime",
      outcome: "success",
      examAttemptId: "sa-1",
      customerId: "customer-1",
    });
    expect((correlate as { externalIds?: Record<string, unknown> }).externalIds).toMatchObject({
      participantId: "student-1",
    });
  });

  it("emits exam_attempt.score.retrieve success with the raw CloudShare response in the diagnostic payload", async () => {
    const rawProgressPayload = {
      exploredRate: 0.5,
      inProgressRate: 0.25,
      notStartedRate: 0.25,
      passedRate: 0.25,
      failedRate: 0,
      notInitiatedRate: 0.25,
      sectionStatuses: [
        {
          number: 0,
          name: "Check pfSense WAN Interface",
          status: "explored",
          isInFocus: false,
          timeSpent: 338.24936349999996,
        },
        {
          number: 1,
          name: "Validate output",
          status: "inProgress",
          isInFocus: false,
          timeSpent: 7.1577779999999995,
        },
      ],
    };
    const deps = makeScoreDeps({
      scoreRetriever: {
        getParticipantProgress: vi.fn().mockResolvedValue({
          percentComplete: 50,
          stepsCompleted: 1,
          stepsTotal: 2,
          steps: [
            { stepId: "0:Check pfSense WAN Interface", title: "Check pfSense WAN Interface", completed: true, status: "explored" },
            { stepId: "1:Validate output", title: "Validate output", completed: false, status: "in Progress" },
          ],
          exploredRate: 0.5,
          inProgressRate: 0.25,
          notStartedRate: 0.25,
          passedRate: 0.25,
          failedRate: 0,
          notInitiatedRate: 0.25,
        }),
        getParticipantProgressForDiagnostics: vi.fn().mockResolvedValue({
          progress: {
            percentComplete: 50,
            stepsCompleted: 1,
            stepsTotal: 2,
            steps: [
              { stepId: "0:Check pfSense WAN Interface", title: "Check pfSense WAN Interface", completed: true, status: "explored" },
              { stepId: "1:Validate output", title: "Validate output", completed: false, status: "in Progress" },
            ],
            exploredRate: 0.5,
            inProgressRate: 0.25,
            notStartedRate: 0.25,
            passedRate: 0.25,
            failedRate: 0,
            notInitiatedRate: 0.25,
          },
          request: { method: "GET", path: "/guided-journey/progress/exp-s1/student-1" },
          response: { status: 200, body: rawProgressPayload },
        }),
      } satisfies DiagnosticScoreRetrievalProvider,
    });

    const resp = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "sa-1" },
      session: SCORE_SESSION,
    });
    expect(resp.status).toBe(200);

    const entries = await deps._repository.query({ examAttemptId: "sa-1" });
    const retrieve = entries.find((e) => e.operation === "exam_attempt.score.retrieve" && e.outcome === "success");
    expect(retrieve).toBeDefined();
    expect(retrieve).toMatchObject({
      source: "runtime",
      outcome: "success",
      examAttemptId: "sa-1",
      customerId: "customer-1",
    });
    expect((retrieve as { request?: Record<string, unknown> }).request).toEqual({
      method: "GET",
      path: "/guided-journey/progress/exp-s1/student-1",
    });
    expect((retrieve as { response?: Record<string, unknown> }).response).toEqual({
      status: 200,
      body: rawProgressPayload,
    });
  });

  it("emits exam_attempt.score.retrieve failure when score retrieval throws ScoreRetrievalError", async () => {
    const failingRetriever: ScoreRetrievalProvider = {
      getParticipantProgress: vi.fn().mockRejectedValue(
        new CloudShareRequestError("Bad Gateway", 502, {
          integrationSurface: "cloudshare.v4.guided_journey.progress",
          method: "GET",
          path: "/guided-journey/progress/exp-s1/student-1",
        }),
      ),
    };
    const deps = makeScoreDeps({ scoreRetriever: failingRetriever });

    const resp = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "sa-1" },
      session: SCORE_SESSION,
    });
    expect(resp.status).toBe(502);

    const entries = await deps._repository.query({ examAttemptId: "sa-1" });
    const failure = entries.find((e) => e.operation === "exam_attempt.score.retrieve" && e.outcome === "failure");
    expect(failure).toBeDefined();
    expect(failure).toMatchObject({
      source: "runtime",
      outcome: "failure",
      examAttemptId: "sa-1",
      customerId: "customer-1",
    });
    expect(failure?.details).toMatchObject({
      method: "GET",
      path: "/guided-journey/progress/exp-s1/student-1",
      responseStatus: 502,
      integrationSurface: "cloudshare.v4.guided_journey.progress",
      failureMode: "http_status",
    });
  });

  it("emits exam_attempt.score.retrieve failure when diagnostics-aware score retrieval gets an unsupported payload", async () => {
    const malformedRetriever: DiagnosticScoreRetrievalProvider = {
      getParticipantProgress: vi.fn(),
      getParticipantProgressForDiagnostics: vi.fn().mockRejectedValue(
        new CloudShareResponseError("CloudShare Guided Journey progress payload was unsupported", {
          method: "GET",
          path: "/guided-journey/progress/exp-s1/student-1",
          integrationSurface: "cloudshare.v4.guided_journey.progress",
          responseBody: JSON.stringify({ hello: "world", token: "secret" }),
          issues: ["Unsupported Guided Journey progress payload"],
        }),
      ),
    };
    const deps = makeScoreDeps({ scoreRetriever: malformedRetriever });

    const resp = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "sa-1" },
      session: SCORE_SESSION,
    });
    expect(resp.status).toBe(502);

    const entries = await deps._repository.query({ examAttemptId: "sa-1" });
    const failure = entries.find((e) => e.operation === "exam_attempt.score.retrieve" && e.outcome === "failure");
    expect(failure).toBeDefined();
    expect(failure?.details).toMatchObject({
      method: "GET",
      path: "/guided-journey/progress/exp-s1/student-1",
      integrationSurface: "cloudshare.v4.guided_journey.progress",
      failureMode: "unexpected_response",
    });
    expect(JSON.stringify(failure)).not.toContain("secret");
  });

  it("emits exam_attempt.score.retrieve failure with unexpected_response details when a recognized payload fails normalized validation", async () => {
    const malformedRetriever: DiagnosticScoreRetrievalProvider = {
      getParticipantProgress: vi.fn(),
      getParticipantProgressForDiagnostics: vi.fn().mockRejectedValue(
        new CloudShareResponseError("CloudShare Guided Journey progress payload was unsupported", {
          method: "GET",
          path: "/guided-journey/progress/exp-s1/student-1",
          integrationSurface: "cloudshare.v4.guided_journey.progress",
          responseBody: JSON.stringify({ exploredRate: 1.2, token: "secret" }),
          issues: ["Number must be less than or equal to 1"],
        }),
      ),
    };
    const deps = makeScoreDeps({ scoreRetriever: malformedRetriever });

    const resp = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "sa-1" },
      session: SCORE_SESSION,
    });
    expect(resp.status).toBe(502);

    const entries = await deps._repository.query({ examAttemptId: "sa-1" });
    const failure = entries.find((e) => e.operation === "exam_attempt.score.retrieve" && e.outcome === "failure");
    expect(failure?.details).toMatchObject({
      method: "GET",
      path: "/guided-journey/progress/exp-s1/student-1",
      integrationSurface: "cloudshare.v4.guided_journey.progress",
      failureMode: "unexpected_response",
    });
    expect(JSON.stringify(failure)).not.toContain("secret");
  });
});
