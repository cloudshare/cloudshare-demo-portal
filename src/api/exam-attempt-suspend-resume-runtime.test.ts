import { describe, it, expect, vi } from "vitest";
import {
  suspendExamAttemptRuntime,
  resumeExamAttemptRuntime,
  runHeartbeatAutoSuspendRuntime,
} from "./exam-attempt-suspend-resume-runtime";
import type { SuspendHandlerDeps, ResumeHandlerDeps } from "./exam-attempt-suspend-resume-runtime";
import type { ExamTimer, EnvironmentController } from "@/domain/exam-attempt-runtime-lifecycle";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { LabLaunch, LabLaunchRepository, LabProvisioner } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import { createExamClock, createInMemoryExamClockRepository, type ExamClock } from "@/domain/exam-clock";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import type { CloudShareClient } from "@/integrations/cloudshare";
import type { EnvironmentCommandResult } from "@/domain/environment";

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
  participantEmail: "candidate@helioscx.demo",
  trainingId: "EXtraining-1",
  experienceId: "exp-1",
  environmentExternalId: "ENVS-default-live-env-1",
  loginUrl: "https://old.lab.url",
  status: "launched" as const,
  createdAt: new Date(),
};

function makeLaunches(found: LabLaunch | null = launch): LabLaunchRepository {
  const launches = createInMemoryLabLaunchRepository();
  if (found) {
    void launches.save(found);
  }
  return {
    save: (record) => launches.save(record),
    findById: (id) => launches.findById(id),
    findByExamAttemptId: (examAttemptId) => launches.findByExamAttemptId(examAttemptId),
    findByCustomerIdAndEnvironmentExternalId: (_customerId, environmentExternalId) =>
      launches.findByCustomerIdAndEnvironmentExternalId(_customerId, environmentExternalId),
  };
}

function makeTimer(): ExamTimer {
  return {
    pauseTimer: () => Promise.resolve(),
    resumeTimer: () => Promise.resolve(),
  };
}

async function makeExams() {
  const exams = createInMemoryExamCatalogRepository();
  await createDraftExam(
    {
      repository: exams,
      now: () => new Date("2026-06-15T09:00:00.000Z"),
      newId: () => "exam-1",
    },
    {
      customerId: "customer-1",
      title: "Helios Guided Journey",
      description: "Hands-on exam",
      timeLimitMinutes: 60,
      scoreRetrievalEnabled: true,
      projectId: "project-1",
      projectName: "Helios CX",
      blueprintId: "bp-1",
      blueprintName: "Helios Guided Journey",
      snapshotId: "snap-1",
      snapshotName: "Default Snapshot",
      allowedRegions: [{ id: "region-1", name: "EU West" }],
      policyId: "policy-1",
      policyName: "Standard Policy",
      instructorId: "instructor-1",
      instructorName: "Helios Service Account",
    },
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-06-15T09:05:00.000Z") },
    { customerId: "customer-1", examId: "exam-1" },
  );
  return exams;
}

function makeClock(nowIso = "2026-06-15T10:10:00.000Z"): {
  clock: ExamClock;
  repository: ReturnType<typeof createInMemoryExamClockRepository>;
} {
  const repository = createInMemoryExamClockRepository();
  const clock = createExamClock({
    clocks: repository,
    now: () => new Date(nowIso),
  });
  return { clock, repository };
}

function makeController(): EnvironmentController {
  return {
    suspendEnvironment: () => Promise.resolve(makeCommandResult("suspend", "ENVS-default-live-env-1")),
    resumeEnvironment: () => Promise.resolve(makeCommandResult("resume", "ENVS-default-live-env-1")),
  };
}

function makeCommandResult(
  action: "suspend" | "resume",
  environmentId: string,
): EnvironmentCommandResult {
  return {
    attemptedOperation: `${action}_environment`,
    integrationSurface: `cloudshare.v3.env.action.${action}`,
    method: "PUT",
    path: `/api/v3/envs/actions/${action}`,
    externalIds: { environmentId },
    request: {
      method: "PUT",
      path: `/api/v3/envs/actions/${action}`,
    },
    response: {
      status: 200,
      body: "",
    },
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

function makeConnections(
  connection: CloudShareConnectionRecord | null = {
    customerId: "customer-1",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "whsec",
    webhookPathToken: "whk-customer-1",
    connectedAt: new Date("2026-06-15T08:00:00.000Z"),
    verifiedAt: new Date("2026-06-15T08:05:00.000Z"),
  },
): CloudShareConnectionRepository {
  return {
    save: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue(connection),
    findByWebhookPathToken: vi.fn().mockResolvedValue(connection),
    markVerified: vi.fn(),
  };
}

function makeCloudShareFactory(overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> = {}): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3: vi.fn(),
      requestV3Text: vi.fn().mockResolvedValue(""),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected path ${spec.path}`);
      }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"],
      ...overrides,
    }),
  };
}

function activeParticipantRequestV4(
  environmentId = "ENVd0WBTGirla-omK6Jh3BvA2",
): CloudShareClient["requestV4"] {
  return vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
    if (spec.path === "/trainings/EXtraining-1/students") {
      return spec.schema.parse([
        {
          email: "candidate@helioscx.demo",
          envId: environmentId,
          envStatus: "ready",
          participationStatus: "inProgress",
        },
      ]);
    }
    throw new Error(`unexpected v4 path ${spec.path}`);
  }) as unknown as CloudShareClient["requestV4"];
}

function makeSuspendCloudShareFactory(): CloudShareClientFactory {
  return {
    forConnection: () =>
      makeCloudShareClient({
        requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
          if (spec.path === "/envs/actions/suspend") {
            return spec.schema.parse({});
          }
          if (spec.path.startsWith("/envs/")) {
            return spec.schema.parse({ envStatus: "Suspended" });
          }
          throw new Error(`unexpected v3 path ${spec.path}`);
        }) as unknown as CloudShareClient["requestV3"],
        requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
          if (spec.path === "/trainings/EXtraining-1/students") {
            return spec.schema.parse([
              {
                email: "candidate@helioscx.demo",
                environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
                environmentStatus: "ready",
              },
            ]);
          }
          throw new Error(`unexpected v4 path ${spec.path}`);
        }) as unknown as CloudShareClient["requestV4"],
      }),
  };
}

function makeResumeCloudShareFactory(): CloudShareClientFactory {
  return {
    forConnection: () =>
      makeCloudShareClient({
        requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
          if (spec.path === "/envs/actions/resume") {
            return spec.schema.parse({});
          }
          if (spec.path.startsWith("/envs/")) {
            return spec.schema.parse({ envStatus: "Running" });
          }
          throw new Error(`unexpected v3 path ${spec.path}`);
        }) as unknown as CloudShareClient["requestV3"],
        requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
          if (spec.path === "/trainings/EXtraining-1/students") {
            return spec.schema.parse([
              {
                email: "candidate@helioscx.demo",
                environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
                environmentStatus: "ready",
              },
            ]);
          }
          throw new Error(`unexpected v4 path ${spec.path}`);
        }) as unknown as CloudShareClient["requestV4"],
      }),
  };
}

function makeCloudShareClient(overrides: Partial<CloudShareClient> = {}): CloudShareClient {
  return {
    requestV3: vi.fn(),
    requestV3Text: vi.fn().mockResolvedValue(""),
    requestV4: activeParticipantRequestV4(),
    ...overrides,
  } as CloudShareClient;
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

async function makeAttemptsWithCustomer(
  examAttemptId: string,
  status: "ready" | "scheduled" | "in_progress" | "suspended" | "completed" | "expired",
  customerId: string | null,
) {
  const attempts = createInMemoryExamAttemptRepository();
  await attempts.save({
    id: examAttemptId,
    customerId: customerId ?? undefined,
    candidateId: "cand-1",
    examId: "exam-1",
    status,
    scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
  });
  return attempts;
}

async function makeSuspendDeps(overrides: Partial<SuspendHandlerDeps> = {}): Promise<SuspendHandlerDeps> {
  const { clock } = makeClock();
  return {
    controller: makeController(),
    source: fixedSource("suspended"),
    timer: makeTimer(),
    clocks: clock,
    exams: await makeExams(),
    attempts: await makeAttempts("in_progress"),
    launches: makeLaunches(),
    sleep: noSleep,
    logger: makeLogger(),
    eventLog: {
      append: vi.fn().mockResolvedValue(undefined),
      listFailureEventsByExamAttemptIds: vi.fn().mockResolvedValue([]),
      listAll: vi.fn(),
    },
    connections: makeConnections(),
    cloudshare: makeSuspendCloudShareFactory(),
    newCorrelationId: () => "corr-suspend",
    now: () => new Date("2026-06-15T10:10:00.000Z"),
    ...overrides,
  };
}

async function makeResumeDeps(overrides: Partial<ResumeHandlerDeps> = {}): Promise<ResumeHandlerDeps> {
  const { clock } = makeClock();
  return {
    controller: makeController(),
    source: fixedSource("running"),
    timer: makeTimer(),
    clocks: clock,
    exams: await makeExams(),
    attempts: await makeAttempts("suspended"),
    launches: makeLaunches(),
    labs: makeLabs(),
    sleep: noSleep,
    logger: makeLogger(),
    eventLog: {
      append: vi.fn().mockResolvedValue(undefined),
      listFailureEventsByExamAttemptIds: vi.fn().mockResolvedValue([]),
      listAll: vi.fn(),
    },
    connections: makeConnections(),
    cloudshare: makeResumeCloudShareFactory(),
    newCorrelationId: () => "corr-resume",
    now: () => new Date("2026-06-15T10:10:00.000Z"),
    ...overrides,
  };
}

// --- suspendExamAttemptRuntime ---

describe("suspendExamAttemptRuntime", () => {
  it("returns 200 and status=suspended on success", async () => {
    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps(),
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("suspended");
    expect(resp.body.examAttemptId).toBe("ea-1");
  });

  it("reconciles runtime exhaustion before suspend and completes the attempt instead", async () => {
    const { clock, repository } = makeClock("2026-06-15T16:00:30.000Z");
    await repository.save({
      examAttemptId: "ea-1",
      status: "running",
      elapsedAtPauseMs: 59 * 60 * 1000,
      startedAt: new Date("2026-06-15T15:59:30.000Z"),
      updatedAt: new Date("2026-06-15T15:59:30.000Z"),
    });
    const attempts = await makeAttempts("in_progress");
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };

    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV3Text: vi.fn(),
      requestV4: vi.fn(),
    });
    const cloudshare = {
      forConnection: vi.fn().mockReturnValue(customerClient),
    } satisfies CloudShareClientFactory;

    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps({
        attempts,
        clocks: clock,
        cloudshare,
        diagnostics,
        candidateEmail: "candidate@helioscx.demo",
      }),
      { examAttemptId: "ea-1" },
    );

    expect(resp.status).toBe(409);
    expect(resp.body).toMatchObject({
      currentStatus: "completed",
      expectedStatus: "in_progress",
      operation: "suspend",
    });
    await expect(attempts.findById("ea-1")).resolves.toMatchObject({
      status: "completed",
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    expect(customerClient.requestV4).not.toHaveBeenCalled();
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    expect(customerClient.requestV3Text).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "success",
        customerId: "customer-1",
        candidateEmail: "candidate@helioscx.demo",
        examId: "exam-1",
        examAttemptId: "ea-1",
        details: expect.objectContaining({
          completedBy: "portal_runtime_reconciliation",
          attemptStatus: "completed",
        }),
      }),
    );
    expect(diagnostics.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: "exam_attempt.suspend",
        outcome: "failure",
        details: expect.objectContaining({
          failureMode: "invalid_status",
          currentStatus: "completed",
        }),
      }),
    );
  });

  it("uses the attempt customer's CloudShare connection and envId semantics, not the global environment adapter", async () => {
    const globalController = {
      suspendEnvironment: vi.fn().mockResolvedValue(undefined),
      resumeEnvironment: vi.fn().mockResolvedValue(undefined),
    };
    const globalSource = {
      getEnvironmentState: vi.fn().mockResolvedValue({ environmentExternalId: "portal-ext-1", status: "suspended" }),
    };
    const customerClient = makeCloudShareClient({
      requestV3: vi
        .fn()
        .mockResolvedValue({ envStatus: "Suspended" }),
      requestV4: activeParticipantRequestV4(),
    });
    const cloudshare = {
      forConnection: vi.fn().mockReturnValue(customerClient),
    } satisfies CloudShareClientFactory;

    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps({
        controller: globalController,
        source: globalSource,
        cloudshare,
        launches: makeLaunches({
          id: "launch-1",
          examAttemptId: "ea-1",
          candidateId: "cand-1",
          experienceId: "EXtraining-1",
          trainingId: "EXtraining-1",
          participantEmail: "candidate@helioscx.demo",
          environmentExternalId: "ENVstays-live-shaped",
          loginUrl: "https://old.lab.url",
          status: "launched",
          createdAt: new Date(),
        }),
      }),
      { examAttemptId: "ea-1" },
    );

    expect(resp.status).toBe(200);
    expect(cloudshare.forConnection).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "customer-1" }),
    );
    expect(customerClient.requestV3Text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/suspend",
        query: { envId: "ENVd0WBTGirla-omK6Jh3BvA2" },
      }),
    );
    expect(customerClient.requestV3).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/envs/ENVd0WBTGirla-omK6Jh3BvA2",
      }),
    );
    expect(globalController.suspendEnvironment).not.toHaveBeenCalled();
    expect(globalSource.getEnvironmentState).not.toHaveBeenCalled();
  });

  it("discovers the training participant environment ID before suspend when the launch was created without one", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/envs/ENVS2n38LTNdcC4sHsqnjRzg2") {
          return spec.schema.parse({ envStatus: "Suspended" });
        }
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV3"],
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const cloudshare = {
      forConnection: vi.fn().mockReturnValue(customerClient),
    } satisfies CloudShareClientFactory;

    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps({
        launches,
        cloudshare,
      }),
      { examAttemptId: "ea-1" },
    );

    expect(resp.status).toBe(200);
    expect(customerClient.requestV3Text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/suspend",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
    await expect(launches.findByExamAttemptId("ea-1")).resolves.toMatchObject({
      environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
    });
  });

  it("does not call CloudShare suspend with a pending placeholder envId and fails as not correlated yet", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse({
            count: 1,
            items: [
              {
                email: "candidate@helioscx.demo",
                participationStatus: "pending",
                envStatus: null,
                envId: "ENKolD1-ab84YIxODeMGob9A2",
              },
            ],
          });
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const deps = await makeSuspendDeps({
      launches,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    const resp = await suspendExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(202);
    expect(resp.body).toEqual({
      status: "pending",
      operation: "suspend",
      examAttemptId: "ea-1",
      retryable: true,
      correlationId: "corr-suspend",
      message: "CloudShare is still suspending your lab. Wait a few seconds, then retry Suspend lab.",
    });
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    await expect(launches.findByExamAttemptId("ea-1")).resolves.not.toMatchObject({
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
    });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.exam_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "exam_suspend",
          attemptedOperation: "resolve_environment_correlation",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/EXtraining-1/students",
          failureMode: "not_correlated_yet",
          currentEnvironmentExternalId: null,
        }),
      }),
    );
  });

  it("does not call CloudShare suspend with a persisted placeholder envId when participant refresh fails", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV4: vi.fn(async () => {
        throw new CloudShareRequestError("forbidden", 403, {
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/EXtraining-1/students",
          responseBody: "{\"error\":\"forbidden\"}",
        });
      }) as unknown as CloudShareClient["requestV4"],
    });
    const deps = await makeSuspendDeps({
      launches,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    const resp = await suspendExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(202);
    expect(resp.body).toEqual({
      status: "pending",
      operation: "suspend",
      examAttemptId: "ea-1",
      retryable: true,
      correlationId: "corr-suspend",
      message: "CloudShare is still suspending your lab. Wait a few seconds, then retry Suspend lab.",
    });
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.exam_suspend.environment_correlation.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "exam_suspend",
          attemptedOperation: "list_training_participants",
          integrationSurface: "cloudshare.v4.training.participant_list",
          failureMode: "http_status",
          responseStatus: 403,
        }),
      }),
    );
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.exam_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "exam_suspend",
          attemptedOperation: "resolve_environment_correlation",
          failureMode: "not_correlated_yet",
          currentEnvironmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
        }),
      }),
    );
  });

  it("returns 404 when no launch exists for the exam attempt", async () => {
    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps({
        attempts: await makeAttemptsFor("ea-missing", "in_progress"),
        launches: makeLaunches(null),
      }),
      { examAttemptId: "ea-missing" },
    );
    expect(resp.status).toBe(404);
  });

  it("returns 502 when poll times out (TimerSyncError, not a not-found)", async () => {
    const deps = await makeSuspendDeps({
        source: fixedSource("running"),
        poll: { maxAttempts: 1, intervalMs: 0 },
        cloudshare: {
          forConnection: vi.fn().mockReturnValue(
            makeCloudShareClient({
              requestV3: vi
                .fn()
                .mockResolvedValue({ envStatus: "Running" }),
            }),
          ),
        },
      });
    const resp = await suspendExamAttemptRuntime(
      deps,
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(202);
    expect(resp.body).toEqual({
      status: "pending",
      operation: "suspend",
      examAttemptId: "ea-1",
      retryable: true,
      correlationId: "corr-suspend",
      message: "CloudShare is still suspending your lab. Wait a few seconds, then retry Suspend lab.",
    });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.exam_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "exam_suspend",
          attemptedOperation: "poll_environment_status",
          integrationSurface: "cloudshare.v3.env",
          method: "GET",
          failureMode: "confirmation_timeout",
        }),
      }),
    );
  });

  it("returns 409 when suspend is requested outside the in_progress state", async () => {
    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps({
        attempts: await makeAttempts("ready"),
      }),
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(409);
    expect(resp.body).toMatchObject({
      error: "Exam attempt is not in a valid status for this transition",
      expectedStatus: "in_progress",
      currentStatus: "ready",
    });
  });

  it("returns 502 with diagnostics and does not touch global adapters when the customer CloudShare connection is missing", async () => {
    const globalController = {
      suspendEnvironment: vi.fn().mockResolvedValue(undefined),
      resumeEnvironment: vi.fn().mockResolvedValue(undefined),
    };
    const globalSource = {
      getEnvironmentState: vi.fn().mockResolvedValue({ environmentExternalId: "env-1", status: "suspended" }),
    };
    const cloudshare = {
      forConnection: vi.fn(),
    } satisfies CloudShareClientFactory;
    const deps = await makeSuspendDeps({
      controller: globalController,
      source: globalSource,
      connections: makeConnections(null),
      cloudshare,
    });

    const resp = await suspendExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam suspend failed", correlationId: "corr-suspend" });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    expect(globalController.suspendEnvironment).not.toHaveBeenCalled();
    expect(globalSource.getEnvironmentState).not.toHaveBeenCalled();
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.exam_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "exam_suspend",
          attemptedOperation: "load_customer_cloudshare_connection",
          integrationSurface: "cloudshare.connection",
          failureMode: "missing_customer_connection",
          customerId: "customer-1",
        }),
      }),
    );
  });

  it("returns 502 with supportable diagnostics when CloudShare suspend returns an http status error", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new CloudShareRequestError("forbidden", 403, {
          integrationSurface: "cloudshare.v3.env.action.suspend",
          method: "PUT",
          path: "/api/v3/envs/actions/suspend",
          responseBody: "{\"error\":\"forbidden\"}",
        });
      }) as unknown as CloudShareClient["requestV3Text"],
    });
    const deps = await makeSuspendDeps({
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });
    const resp = await suspendExamAttemptRuntime(
      deps,
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam suspend failed", correlationId: "corr-suspend" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          attemptedOperation: "suspend_environment",
          integrationSurface: "cloudshare.v3.env.action.suspend",
          method: "PUT",
          path: "/api/v3/envs/actions/suspend",
          failureMode: "http_status",
          responseStatus: 403,
          responseBody: "{\"error\":\"forbidden\"}",
        }),
      }),
    );
  });

  it("returns 500 on an unexpected error", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new Error("unexpected");
      }) as unknown as CloudShareClient["requestV3Text"],
    });
    const resp = await suspendExamAttemptRuntime(
      await makeSuspendDeps({
        cloudshare: {
          forConnection: vi.fn().mockReturnValue(customerClient),
        },
      }),
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(500);
    expect(resp.body).toEqual({ error: "internal error", correlationId: "corr-suspend" });
  });
});

// --- resumeExamAttemptRuntime ---

describe("resumeExamAttemptRuntime", () => {
  it("returns 200 without loginUrl and with preservation limit on success", async () => {
    const resp = await resumeExamAttemptRuntime(
      await makeResumeDeps({ labs: makeLabs("https://new.lab.url") }),
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(200);
    expect(resp.body.status).toBe("resumed");
    expect(resp.body).not.toHaveProperty("loginUrl");
    expect(typeof resp.body.suspendedPreservationLimitMs).toBe("number");
    expect(JSON.stringify(resp.body)).not.toContain("loginUrl");
  });

  it("reconciles runtime exhaustion before resume and completes the attempt instead", async () => {
    const { clock, repository } = makeClock("2026-06-15T16:00:30.000Z");
    await repository.save({
      examAttemptId: "ea-1",
      status: "running",
      elapsedAtPauseMs: 59 * 60 * 1000,
      startedAt: new Date("2026-06-15T15:59:30.000Z"),
      updatedAt: new Date("2026-06-15T15:59:30.000Z"),
    });
    const attempts = await makeAttempts("suspended");
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) };

    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV3Text: vi.fn(),
      requestV4: vi.fn(),
    });
    const cloudshare = {
      forConnection: vi.fn().mockReturnValue(customerClient),
    } satisfies CloudShareClientFactory;

    const resp = await resumeExamAttemptRuntime(
      await makeResumeDeps({
        attempts,
        clocks: clock,
        cloudshare,
        diagnostics,
        candidateEmail: "candidate@helioscx.demo",
      }),
      { examAttemptId: "ea-1" },
    );

    expect(resp.status).toBe(409);
    expect(resp.body).toMatchObject({
      currentStatus: "completed",
      expectedStatus: "suspended",
      operation: "resume",
    });
    await expect(attempts.findById("ea-1")).resolves.toMatchObject({
      status: "completed",
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    expect(customerClient.requestV4).not.toHaveBeenCalled();
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    expect(customerClient.requestV3Text).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "success",
        customerId: "customer-1",
        candidateEmail: "candidate@helioscx.demo",
        examId: "exam-1",
        examAttemptId: "ea-1",
        details: expect.objectContaining({
          completedBy: "portal_runtime_reconciliation",
          attemptStatus: "completed",
        }),
      }),
    );
    expect(diagnostics.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: "exam_attempt.resume",
        outcome: "failure",
        details: expect.objectContaining({
          failureMode: "invalid_status",
          currentStatus: "completed",
        }),
      }),
    );
  });

  it("returns 404 when no launch exists", async () => {
    const resp = await resumeExamAttemptRuntime(
      await makeResumeDeps({
        attempts: await makeAttemptsFor("ea-missing", "suspended"),
        launches: makeLaunches(null),
      }),
      { examAttemptId: "ea-missing" },
    );
    expect(resp.status).toBe(404);
  });

  it("returns a retryable pending response when poll confirmation times out", async () => {
    const deps = await makeResumeDeps({
        cloudshare: {
          forConnection: vi.fn().mockReturnValue(
            makeCloudShareClient({
              requestV3: vi
                .fn()
                .mockResolvedValue({ envStatus: "Suspended" }),
            }),
          ),
        },
        source: fixedSource("suspended"),
        poll: { maxAttempts: 1, intervalMs: 0 },
      });
    const resp = await resumeExamAttemptRuntime(
      deps,
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(202);
    expect(resp.body).toEqual({
      status: "pending",
      operation: "resume",
      examAttemptId: "ea-1",
      retryable: true,
      correlationId: "corr-resume",
      message: "CloudShare is still resuming your lab. Wait a few seconds, then retry Resume exam.",
    });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-resume",
        payload: expect.objectContaining({
          correlationId: "corr-resume",
          attemptedOperation: "poll_environment_status",
          integrationSurface: "cloudshare.v3.env",
          failureMode: "confirmation_timeout",
        }),
      }),
    );
  });

  it("returns 409 when resume is requested from a non-resumable status", async () => {
    const resp = await resumeExamAttemptRuntime(
      await makeResumeDeps({
        attempts: await makeAttempts("ready"),
      }),
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(409);
    expect(resp.body).toMatchObject({
      error: "Exam attempt is not in a valid status for this transition",
      expectedStatus: "suspended",
      currentStatus: "ready",
    });
  });

  it("treats a repeated resume request after a successful resume as idempotent", async () => {
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/envs/actions/resume") {
          return spec.schema.parse({});
        }
        if (spec.path.startsWith("/envs/")) {
          return spec.schema.parse({ envStatus: "Running" });
        }
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV3"],
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const timer = {
      pauseTimer: vi.fn(),
      resumeTimer: vi.fn().mockResolvedValue(undefined),
    };
    const deps = await makeResumeDeps({
      timer,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    const first = await resumeExamAttemptRuntime(deps, { examAttemptId: "ea-1" });
    const second = await resumeExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      status: "resumed",
      examAttemptId: "ea-1",
    });
    expect(timer.resumeTimer).toHaveBeenCalledTimes(1);
    expect(customerClient.requestV3Text).toHaveBeenCalledTimes(1);
  });

  it("recovers a duplicate fast resume when CloudShare rejects the action but the environment is already active", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new CloudShareRequestError("already resumed", 409, {
          integrationSurface: "cloudshare.v3.env.action.resume",
          method: "PUT",
          path: "/api/v3/envs/actions/resume",
          environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
          responseBody: "{\"error\":\"already running\"}",
        });
      }) as unknown as CloudShareClient["requestV3Text"],
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path.startsWith("/envs/")) {
          return spec.schema.parse({ envStatus: "Running" });
        }
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV3"],
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const timer = {
      pauseTimer: vi.fn(),
      resumeTimer: vi.fn().mockResolvedValue(undefined),
    };
    const deps = await makeResumeDeps({
      timer,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    const resp = await resumeExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({
      status: "resumed",
      resumeDisposition: "already_active",
      examAttemptId: "ea-1",
      environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
    });
    expect(timer.resumeTimer).toHaveBeenCalledTimes(1);
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    expect(deps.eventLog.append).not.toHaveBeenCalled();
  });

  it("falls back to the normal CloudShare failure diagnostic when already-active recovery itself fails", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new CloudShareRequestError("already resumed", 409, {
          integrationSurface: "cloudshare.v3.env.action.resume",
          method: "PUT",
          path: "/api/v3/envs/actions/resume",
          environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
          responseBody: "{\"error\":\"already running\"}",
        });
      }) as unknown as CloudShareClient["requestV3Text"],
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path.startsWith("/envs/")) {
          return spec.schema.parse({ envStatus: "Running" });
        }
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV3"],
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const deps = await makeResumeDeps({
      timer: {
        pauseTimer: vi.fn(),
        resumeTimer: vi.fn().mockRejectedValue(new Error("timer unavailable")),
      },
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    const resp = await resumeExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-resume",
        type: "cloudshare.exam_resume.failed",
        payload: expect.objectContaining({
          correlationId: "corr-resume",
          operation: "exam_resume",
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v3.env.action.resume",
          method: "PUT",
          path: "/api/v3/envs/actions/resume",
          failureMode: "http_status",
          responseStatus: 409,
          responseBody: "{\"error\":\"already running\"}",
        }),
      }),
    );
  });

  it("does not call CloudShare resume with a persisted placeholder envId when participant refresh finds no matching active participant", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse({
            count: 1,
            items: [
              {
                email: "other@helioscx.demo",
                participationStatus: "pending",
                envStatus: null,
                envId: "ENKolD1-ab84YIxODeMGob9A2",
              },
            ],
          });
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const deps = await makeResumeDeps({
      launches,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    const resp = await resumeExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(202);
    expect(resp.body).toEqual({
      status: "pending",
      operation: "resume",
      examAttemptId: "ea-1",
      retryable: true,
      correlationId: "corr-resume",
      message: "CloudShare is still resuming your lab. Wait a few seconds, then retry Resume exam.",
    });
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-resume",
        type: "cloudshare.exam_resume.failed",
        payload: expect.objectContaining({
          correlationId: "corr-resume",
          operation: "exam_resume",
          attemptedOperation: "resolve_environment_correlation",
          failureMode: "not_correlated_yet",
          currentEnvironmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
        }),
      }),
    );
  });

  it("returns 502 with diagnostics and does not touch global adapters when the exam attempt has no customer binding", async () => {
    const globalController = {
      suspendEnvironment: vi.fn().mockResolvedValue(undefined),
      resumeEnvironment: vi.fn().mockResolvedValue(undefined),
    };
    const globalSource = {
      getEnvironmentState: vi.fn().mockResolvedValue({ environmentExternalId: "env-1", status: "running" }),
    };
    const cloudshare = {
      forConnection: vi.fn(),
    } satisfies CloudShareClientFactory;
    const deps = await makeResumeDeps({
      controller: globalController,
      source: globalSource,
      attempts: await makeAttemptsWithCustomer("ea-1", "suspended", null),
      cloudshare,
    });

    const resp = await resumeExamAttemptRuntime(deps, { examAttemptId: "ea-1" });

    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    expect(globalController.resumeEnvironment).not.toHaveBeenCalled();
    expect(globalSource.getEnvironmentState).not.toHaveBeenCalled();
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-resume",
        type: "cloudshare.exam_resume.failed",
        payload: expect.objectContaining({
          correlationId: "corr-resume",
          operation: "exam_resume",
          attemptedOperation: "load_customer_cloudshare_connection",
          integrationSurface: "cloudshare.connection",
          failureMode: "missing_customer_connection",
        }),
      }),
    );
  });

  it("returns 502 with transport diagnostics when CloudShare resume transport fails", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new CloudShareTransportError("network down", {
          integrationSurface: "cloudshare.v3.env.action.resume",
          method: "POST",
          path: "/api/v3/envs/actions/resume",
          cause: "ECONNRESET",
        });
      }) as unknown as CloudShareClient["requestV3Text"],
    });
    const deps = await makeResumeDeps({
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });
    const resp = await resumeExamAttemptRuntime(
      deps,
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v3.env.action.resume",
          method: "POST",
          path: "/api/v3/envs/actions/resume",
          failureMode: "transport",
          cause: "ECONNRESET",
        }),
      }),
    );
  });

  it("returns 502 with response-shape diagnostics when CloudShare resume returns an unexpected payload", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new CloudShareResponseError("schema mismatch", {
          integrationSurface: "cloudshare.v3.env.action.resume",
          method: "PUT",
          path: "/api/v3/envs/actions/resume",
          responseBody: "{\"bad\":true}",
          issues: ["Required"],
        });
      }) as unknown as CloudShareClient["requestV3Text"],
    });
    const deps = await makeResumeDeps({
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });
    const resp = await resumeExamAttemptRuntime(
      deps,
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(502);
    expect(resp.body).toEqual({ error: "exam resume failed", correlationId: "corr-resume" });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          attemptedOperation: "resume_environment",
          integrationSurface: "cloudshare.v3.env.action.resume",
          failureMode: "unexpected_response",
          responseBody: "{\"bad\":true}",
          issues: ["Required"],
        }),
      }),
    );
  });

  it("returns 500 on an unexpected error", async () => {
    const customerClient = makeCloudShareClient({
      requestV3Text: vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as CloudShareClient["requestV3Text"],
    });
    const resp = await resumeExamAttemptRuntime(
      await makeResumeDeps({
        cloudshare: {
          forConnection: vi.fn().mockReturnValue(customerClient),
        },
      }),
      { examAttemptId: "ea-1" },
    );
    expect(resp.status).toBe(500);
    expect(resp.body).toEqual({ error: "internal error", correlationId: "corr-resume" });
  });
});

describe("runHeartbeatAutoSuspendRuntime", () => {
  it("discovers the training participant environment ID before auto-suspend when the launch lacks a pre-existing environmentExternalId", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/envs/ENVS2n38LTNdcC4sHsqnjRzg2") {
          return spec.schema.parse({ envStatus: "Suspended" });
        }
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV3"],
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
              environmentStatus: "ready",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const cloudshare = {
      forConnection: vi.fn().mockReturnValue(customerClient),
    } satisfies CloudShareClientFactory;
    const deps = await makeSuspendDeps({
      launches,
      cloudshare,
    });

    await expect(runHeartbeatAutoSuspendRuntime(deps, "ea-1")).resolves.toBeUndefined();
    expect(customerClient.requestV3Text).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/suspend",
        query: { envId: "ENVS2n38LTNdcC4sHsqnjRzg2" },
      }),
    );
    await expect(launches.findByExamAttemptId("ea-1")).resolves.toMatchObject({
      environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
    });
  });

  it("does not call CloudShare suspend with a pending placeholder envId during heartbeat auto-suspend", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse({
            count: 1,
            items: [
              {
                email: "candidate@helioscx.demo",
                participationStatus: "pending",
                envStatus: null,
                envId: "ENKolD1-ab84YIxODeMGob9A2",
              },
            ],
          });
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const deps = await makeSuspendDeps({
      launches,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    await expect(runHeartbeatAutoSuspendRuntime(deps, "ea-1")).rejects.toMatchObject({
      message: "No CloudShare environment is correlated to this exam attempt yet.",
    });
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    await expect(launches.findByExamAttemptId("ea-1")).resolves.not.toMatchObject({
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
    });
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.heartbeat_auto_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "heartbeat_auto_suspend",
          attemptedOperation: "resolve_environment_correlation",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/EXtraining-1/students",
          failureMode: "not_correlated_yet",
          currentEnvironmentExternalId: null,
        }),
      }),
    );
  });

  it("does not call CloudShare suspend with a persisted placeholder envId when participant refresh returns a different pending placeholder", async () => {
    const launches = makeLaunches({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "cand-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentId: "ENKolD1-ab84YIxODeMGob9A2",
      environmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
      loginUrl: "https://old.lab.url",
      status: "launched",
      createdAt: new Date(),
    });
    const customerClient = makeCloudShareClient({
      requestV3: vi.fn(),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse({
            count: 1,
            items: [
              {
                email: "candidate@helioscx.demo",
                participationStatus: "pending",
                envStatus: null,
                envId: "ENKnew-placeholder-123",
              },
            ],
          });
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as unknown as CloudShareClient["requestV4"],
    });
    const deps = await makeSuspendDeps({
      launches,
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(customerClient),
      },
    });

    await expect(runHeartbeatAutoSuspendRuntime(deps, "ea-1")).rejects.toMatchObject({
      message: "No CloudShare environment is correlated to this exam attempt yet.",
    });
    expect(customerClient.requestV3).not.toHaveBeenCalled();
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.heartbeat_auto_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "heartbeat_auto_suspend",
          attemptedOperation: "resolve_environment_correlation",
          failureMode: "not_correlated_yet",
          currentEnvironmentExternalId: "ENKolD1-ab84YIxODeMGob9A2",
        }),
      }),
    );
  });

  it.each([
    [
      "CloudShareRequestError",
      new CloudShareRequestError("forbidden", 403, {
        integrationSurface: "cloudshare.v3.env.action.suspend",
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
        responseBody: "{\"error\":\"forbidden\"}",
      }),
      expect.objectContaining({
        operation: "heartbeat_auto_suspend",
        attemptedOperation: "suspend_environment",
        integrationSurface: "cloudshare.v3.env.action.suspend",
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
        failureMode: "http_status",
        responseStatus: 403,
        responseBody: "{\"error\":\"forbidden\"}",
      }),
    ],
    [
      "CloudShareResponseError",
      new CloudShareResponseError("schema mismatch", {
        integrationSurface: "cloudshare.v3.env.action.suspend",
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
        responseBody: "{\"bad\":true}",
        issues: ["Required"],
      }),
      expect.objectContaining({
        operation: "heartbeat_auto_suspend",
        attemptedOperation: "suspend_environment",
        integrationSurface: "cloudshare.v3.env.action.suspend",
        method: "PUT",
        path: "/api/v3/envs/actions/suspend",
        failureMode: "unexpected_response",
        responseBody: "{\"bad\":true}",
        issues: ["Required"],
      }),
    ],
  ])(
    "appends an admin-visible diagnostic and rethrows on %s",
    async (_label, error, expectedPayload) => {
      const customerClient = makeCloudShareClient({
        requestV3Text: vi.fn(async () => {
          throw error;
        }) as unknown as CloudShareClient["requestV3Text"],
      });
      const deps = await makeSuspendDeps({
        cloudshare: {
          forConnection: vi.fn().mockReturnValue(customerClient),
        },
      });

      await expect(runHeartbeatAutoSuspendRuntime(deps, "ea-1")).rejects.toBe(error);
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

  it("appends a missing-connection diagnostic and does not call global adapters when the customer connection is unavailable", async () => {
    const globalController = {
      suspendEnvironment: vi.fn().mockResolvedValue(undefined),
      resumeEnvironment: vi.fn().mockResolvedValue(undefined),
    };
    const globalSource = {
      getEnvironmentState: vi.fn().mockResolvedValue({ environmentExternalId: "env-1", status: "suspended" }),
    };
    const cloudshare = {
      forConnection: vi.fn(),
    } satisfies CloudShareClientFactory;
    const deps = await makeSuspendDeps({
      controller: globalController,
      source: globalSource,
      connections: makeConnections(null),
      cloudshare,
    });

    await expect(runHeartbeatAutoSuspendRuntime(deps, "ea-1")).rejects.toMatchObject({
      name: "CustomerEnvironmentAccessError",
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    expect(globalController.suspendEnvironment).not.toHaveBeenCalled();
    expect(globalSource.getEnvironmentState).not.toHaveBeenCalled();
    expect(deps.eventLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "corr-suspend",
        type: "cloudshare.heartbeat_auto_suspend.failed",
        payload: expect.objectContaining({
          correlationId: "corr-suspend",
          operation: "heartbeat_auto_suspend",
          attemptedOperation: "load_customer_cloudshare_connection",
          integrationSurface: "cloudshare.connection",
          failureMode: "missing_customer_connection",
          customerId: "customer-1",
        }),
      }),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "heartbeat auto-suspend failed",
      expect.objectContaining({
        correlationId: "corr-suspend",
        operation: "heartbeat_auto_suspend",
        attemptedOperation: "load_customer_cloudshare_connection",
        failureMode: "missing_customer_connection",
      }),
    );
  });

  it("appends a timeout diagnostic and rethrows when confirmation polling never reaches suspended", async () => {
    const deps = await makeSuspendDeps({
      cloudshare: {
        forConnection: vi.fn().mockReturnValue(
          makeCloudShareClient({
            requestV3: vi
              .fn()
              .mockResolvedValue({ envStatus: "Running" }),
          }),
        ),
      },
      source: fixedSource("running"),
      poll: { maxAttempts: 1, intervalMs: 0 },
    });

    await expect(runHeartbeatAutoSuspendRuntime(deps, "ea-1")).rejects.toMatchObject({
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
          integrationSurface: "cloudshare.v3.env",
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

