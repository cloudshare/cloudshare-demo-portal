import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createDraftExam, publishExam, unpublishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { CloudShareClientFactory, CloudShareConnectionRecord, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import { CloudShareRequestError, CloudShareResponseError } from "@/integrations/cloudshare";
import type { Logger } from "@/observability/logger";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { getExamAttemptDashboardRuntime } from "./exam-attempt-dashboard-runtime";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-helios",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on certification exam.",
    timeLimitMinutes: 90,
    openPeriodMinutes: 120,
    scoreRetrievalEnabled: false,
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [{ id: "region-1", name: "EU West" }],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-1",
    instructorName: "Helios Service Account",
    ...overrides,
  };
}

function makeConnectionRepository(
  connection: CloudShareConnectionRecord | null = {
    customerId: "customer-helios",
    apiId: "api-id",
    apiKey: "api-key",
    webhookSecret: "whsec",
    webhookPathToken: "whk-helios",
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

function makeCloudShareFactory(
  overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> = {},
): CloudShareClientFactory {
  const requestV4 =
    (overrides.requestV4 as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"] | undefined) ??
    (vi.fn(async (spec: { path: string }) => {
      if (spec.path === "/trainings/EXtraining-1/students") {
        return {
          count: 1,
          items: [
            {
              email: "candidate@helioscx.demo",
              envStatus: "ready",
              envId: "ENVS2n38LTNdcC4sHsqnjRzg2",
            },
          ],
        };
      }
      throw new Error(`unexpected path ${spec.path}`);
    }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"]);

  return {
    forConnection: () => ({
      requestV3: vi.fn(),
      requestV3Text: vi.fn(),
      requestV4,
      requestV4Detailed: vi.fn(),
      ...overrides,
    }),
  };
}

async function makeExamRepository() {
  const exams = createInMemoryExamCatalogRepository();
  await createDraftExam(
    { repository: exams, now: () => new Date("2026-06-15T09:00:00.000Z"), newId: () => "exam-1" },
    makeExamInput(),
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-06-15T09:05:00.000Z") },
    { customerId: "customer-helios", examId: "exam-1" },
  );
  return exams;
}

describe("getExamAttemptDashboardRuntime", () => {
  it("keeps later ExamAttempt states visible in a candidate-safe dashboard payload", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const logger = makeLogger();

    await attempts.save({
      id: "attempt-in-progress",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await attempts.save({
      id: "attempt-completed",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "completed",
      scheduledFor: new Date("2026-06-16T16:00:00.000Z"),
      createdAt: new Date("2026-06-16T10:00:00.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      { repository: exams, attempts, logger },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.body).toEqual({
      exams: [
        {
          id: "exam-1",
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: false,
        },
      ],
      attempts: [
        {
          id: "attempt-in-progress",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          timeLimitMinutes: 90,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: false,
          scheduledFor: "2026-06-15T16:00:00.000Z",
          status: "in_progress",
        },
        {
          id: "attempt-completed",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          timeLimitMinutes: 90,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: false,
          scheduledFor: "2026-06-16T16:00:00.000Z",
          status: "completed",
        },
      ],
    });
    expect(JSON.stringify(dashboard.body)).not.toContain("loginUrl");
  });

  it("keeps Exam timing metadata on attempts after the Exam is unpublished", async () => {
    const exams = await makeExamRepository();
    await unpublishExam(
      { repository: exams, now: () => new Date("2026-06-15T09:10:00.000Z") },
      { customerId: "customer-helios", examId: "exam-1" },
    );
    const attempts = createInMemoryExamAttemptRepository();
    const logger = makeLogger();

    await attempts.save({
      id: "attempt-ready",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      { repository: exams, attempts, logger },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.body).toEqual({
      exams: [],
      attempts: [
        expect.objectContaining({
          id: "attempt-ready",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          timeLimitMinutes: 90,
          openPeriodMinutes: 120,
          scoreRetrievalEnabled: false,
          status: "ready",
        }),
      ],
    });
  });

  it("reconciles exhausted runtime to completed and records completion diagnostics", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const logger = makeLogger();
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-15T17:30:30.000Z"),
    });

    await attempts.save({
      id: "attempt-in-progress",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "attempt-in-progress",
      status: "running",
      elapsedAtPauseMs: 89 * 60 * 1000,
      startedAt: new Date("2026-06-15T17:29:30.000Z"),
      updatedAt: new Date("2026-06-15T17:29:30.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      {
        repository: exams,
        attempts,
        clocks,
        diagnostics,
        logger,
      },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.body).toMatchObject({
      attempts: [
        {
          id: "attempt-in-progress",
          status: "completed",
        },
      ],
    });
    await expect(
      diagnosticsRepository.query({
        customerId: "customer-helios",
        examAttemptId: "attempt-in-progress",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.complete",
          outcome: "success",
          examId: "exam-1",
          examAttemptId: "attempt-in-progress",
        }),
      ]),
    );
  });

  it("correlates a discoverable CloudShare environment ID through list-students", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const logger = makeLogger();
    const requestV4 = vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/trainings/EXtraining-1/students") {
        return spec.schema.parse({
          count: 1,
          items: [
            {
              email: "candidate@helioscx.demo",
              envStatus: "ready",
              envId: "ENVS2n38LTNdcC4sHsqnjRzg2",
            },
          ],
        });
      }
      throw new Error(`unexpected path ${spec.path}`);
    });

    await attempts.save({
      id: "attempt-ready",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-ready",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      {
        repository: exams,
        attempts,
        launches,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({ requestV4: requestV4 as never }),
        logger,
      },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.status).toBe(200);
    expect(requestV4).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/trainings/EXtraining-1/students",
      }),
    );
    await expect(launches.findByExamAttemptId("attempt-ready")).resolves.toMatchObject({
      environmentId: "ENVS2n38LTNdcC4sHsqnjRzg2",
      environmentExternalId: "ENVS2n38LTNdcC4sHsqnjRzg2",
    });
    expect(JSON.stringify(dashboard.body)).not.toContain("loginUrl");
  });

  it("records supportable diagnostics when CloudShare environment correlation fails", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const eventLog = createInMemoryEventLogRepository();
    const logger = makeLogger();

    await attempts.save({
      id: "attempt-ready",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-ready",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      {
        repository: exams,
        attempts,
        launches,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV4: vi.fn(async (spec: { path: string }) => {
            if (spec.path === "/trainings/EXtraining-1/students") {
              throw new CloudShareRequestError("forbidden", 403, {
                method: "GET",
                path: "/v4/trainings/EXtraining-1/students",
                integrationSurface: "cloudshare.v4.training.participant_list",
                responseBody: "{\"error\":\"forbidden\"}",
              });
            }
            throw new Error(`unexpected path ${spec.path}`);
          }) as never,
        }),
        eventLog,
        logger,
        now: () => new Date("2026-06-15T10:05:00.000Z"),
        newCorrelationId: () => "corr-list-1",
      },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "candidate dashboard environment correlation failed",
      expect.objectContaining({
        correlationId: "corr-list-1",
        customerId: "customer-helios",
        examAttemptId: "attempt-ready",
        trainingId: "EXtraining-1",
        operation: "candidate_dashboard_environment_correlation",
        attemptedOperation: "list_training_participants",
        integrationSurface: "cloudshare.v4.training.participant_list",
        method: "GET",
        path: "/v4/trainings/EXtraining-1/students",
        failureMode: "http_status",
        responseStatus: 403,
        responseBody: "{\"error\":\"forbidden\"}",
      }),
    );
    await expect(eventLog.listAll()).resolves.toEqual([
      expect.objectContaining({
        eventId: "corr-list-1",
        type: "cloudshare.candidate_dashboard_environment_correlation.failed",
        payload: expect.objectContaining({
          correlationId: "corr-list-1",
          customerId: "customer-helios",
          examAttemptId: "attempt-ready",
          trainingId: "EXtraining-1",
          operation: "candidate_dashboard_environment_correlation",
          attemptedOperation: "list_training_participants",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path: "/v4/trainings/EXtraining-1/students",
          failureMode: "http_status",
          responseStatus: 403,
          responseBody: "{\"error\":\"forbidden\"}",
        }),
      }),
    ]);
  });

  it("shows expired when the correlated CloudShare environment no longer exists", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const logger = makeLogger();

    await attempts.save({
      id: "attempt-suspended",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "suspended",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-suspended",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentExternalId: "ENVS-expired-1",
      environmentId: "ENVS-expired-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      {
        repository: exams,
        attempts,
        launches,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV3: vi.fn(async (spec: { path: string }) => {
            if (spec.path === "/envs/ENVS-expired-1") {
              throw new CloudShareRequestError("not found", 404, {
                method: "GET",
                path: "/v3/envs/ENVS-expired-1",
                integrationSurface: "cloudshare.v3.env.get",
              });
            }
            throw new Error(`unexpected path ${spec.path}`);
          }) as never,
        }),
        logger,
      },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toMatchObject({
      attempts: [
        {
          id: "attempt-suspended",
          status: "expired",
        },
      ],
    });
  });

  it("preserves unexpected_response diagnostics when list-students schema parsing fails", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const eventLog = createInMemoryEventLogRepository();
    const logger = makeLogger();

    await attempts.save({
      id: "attempt-ready",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-ready",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const dashboard = await getExamAttemptDashboardRuntime(
      {
        repository: exams,
        attempts,
        launches,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV4: vi.fn(async (spec: { path: string }) => {
            if (spec.path === "/trainings/EXtraining-1/students") {
              throw new CloudShareResponseError(
                "CloudShare response from https://api.accelerate.cloudshare.com/v4/trainings/EXtraining-1/students did not match the expected schema",
                {
                  method: "GET",
                  host: "api.accelerate.cloudshare.com",
                  path: "/v4/trainings/EXtraining-1/students",
                  integrationSurface: "cloudshare.v4.training.participant_list",
                  responseBody: '{"Students":[{"Id":"student-1"}]}',
                  issues: ["Required"],
                },
              );
            }
            throw new Error(`unexpected path ${spec.path}`);
          }) as never,
        }),
        eventLog,
        logger,
        now: () => new Date("2026-06-15T10:05:00.000Z"),
        newCorrelationId: () => "corr-list-2",
      },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "candidate dashboard environment correlation failed",
      expect.objectContaining({
        correlationId: "corr-list-2",
        failureMode: "unexpected_response",
        host: "api.accelerate.cloudshare.com",
        path: "/v4/trainings/EXtraining-1/students",
        integrationSurface: "cloudshare.v4.training.participant_list",
        responseBody: '{"Students":[{"Id":"student-1"}]}',
        issues: ["Required"],
      }),
    );
    await expect(eventLog.listAll()).resolves.toEqual([
      expect.objectContaining({
        eventId: "corr-list-2",
        payload: expect.objectContaining({
          correlationId: "corr-list-2",
          failureMode: "unexpected_response",
          host: "api.accelerate.cloudshare.com",
          path: "/v4/trainings/EXtraining-1/students",
          integrationSurface: "cloudshare.v4.training.participant_list",
          responseBody: '{"Students":[{"Id":"student-1"}]}',
          issues: ["Required"],
        }),
      }),
    ]);
  });
});
