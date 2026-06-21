import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import type { CloudShareClientFactory, CloudShareConnectionRepository, CloudShareConnectionRecord } from "@/domain/cloudshare-connection";
import { CloudShareRequestError, CloudShareResponseError } from "@/integrations/cloudshare";
import {
  handleGetCandidateDashboard,
  handleScheduleCandidateExam,
} from "./candidate-portal";

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

function makeCloudShareFactory(overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> = {}): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/teams") {
          return spec.schema.parse({ rows: [{ id: "TM-team-1", name: "Helios Team" }] });
        }
        throw new Error(`unexpected v3 path ${spec.path}`);
      }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"],
      requestV3Text: vi.fn(),
      requestV4: vi.fn(async (spec: { path: string }) => {
        if (spec.path === "/trainings") {
          return { id: "EXtraining-1" };
        }
        if (spec.path === "/trainings/EXtraining-1/students") {
          return {};
        }
        if (spec.path === "/trainings/EXtraining-1/sponsored-link") {
          return {
            loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
          };
        }
        throw new Error(`unexpected path ${spec.path}`);
      }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"],
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

describe("candidate scheduling handlers", () => {
  it("schedules an exam and never returns the sponsored loginUrl", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const audit = createInMemoryAuditRepository();
    const eventLog = createInMemoryEventLogRepository();
    const logger = makeLogger();

    const response = await handleScheduleCandidateExam(
      {
        exams,
        attempts,
        launches,
        audit,
        eventLog,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory(),
        logger,
        now: () => new Date("2026-06-15T10:00:00.000Z"),
        newId: vi
          .fn()
          .mockReturnValueOnce("attempt-1")
          .mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-1",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        body: {
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      attempt: {
        id: "attempt-1",
        examId: "exam-1",
        scheduledFor: "2026-06-15T16:00:00.000Z",
        status: "ready",
      },
      coldStartLikely: false,
      correlationId: "corr-1",
    });
    expect(JSON.stringify(response.body)).not.toContain("loginUrl");
    await expect(audit.listByExamAttemptId("attempt-1")).resolves.toEqual([
      expect.objectContaining({
        examAttemptId: "attempt-1",
        action: "lab_launched",
        outcome: "success",
        details: {
          trainingId: "EXtraining-1",
          experienceId: "EXtraining-1",
        },
      }),
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      "candidate exam scheduled",
      expect.objectContaining({
        correlationId: "corr-1",
        customerId: "customer-helios",
        operation: "schedule_exam",
        candidateId: "candidate-1",
        examId: "exam-1",
        examAttemptId: "attempt-1",
      }),
    );

    const dashboard = await handleGetCandidateDashboard(
      { repository: exams, attempts, logger },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toEqual({
      exams: [
        {
          id: "exam-1",
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: false,
        },
      ],
      attempts: [
        {
          id: "attempt-1",
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
          status: "ready",
        },
      ],
    });
    expect(JSON.stringify(dashboard.body)).not.toContain("loginUrl");
  });

  it("records admin-visible diagnostics when CloudShare provisioning fails", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const audit = createInMemoryAuditRepository();
    const eventLog = createInMemoryEventLogRepository();
    const logger = makeLogger();

    const response = await handleScheduleCandidateExam(
      {
        exams,
        attempts,
        launches,
        audit,
        eventLog,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV4: vi.fn(async (spec: { path: string }) => {
            if (spec.path === "/trainings") {
              return { id: "EXtraining-1" };
            }
            throw new CloudShareRequestError("forbidden", 403, {
              requestBody: {
                email: "candidate@helioscx.demo",
                firstName: "Asha",
                lastName: "Patel",
              },
              responseBody: "{\"error\":\"forbidden\"}",
            });
          }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"],
        }),
        logger,
        now: () => new Date("2026-06-15T10:00:00.000Z"),
        newId: vi
          .fn()
          .mockReturnValueOnce("attempt-1")
          .mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-2",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        body: {
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
        },
      },
    );

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "CloudShare provisioning failed for the scheduled exam.",
      correlationId: "corr-2",
    });
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      id: "attempt-1",
      examId: "exam-1",
      candidateId: "candidate-1",
      status: "expired",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
    });
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
    await expect(audit.listByExamAttemptId("attempt-1")).resolves.toEqual([
      expect.objectContaining({
        examAttemptId: "attempt-1",
        action: "lab_launch_failed",
        outcome: "failure",
        details: expect.objectContaining({
          attemptedOperation: "add_participant",
          integrationSurface: "cloudshare.v4.training.participant",
          method: "POST",
          path: "/v4/trainings/EXtraining-1/students",
          failureMode: "http_status",
          responseStatus: 403,
        }),
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      "candidate exam scheduling failed",
      expect.objectContaining({
        correlationId: "corr-2",
        customerId: "customer-helios",
        operation: "schedule_exam",
        attemptedOperation: "add_participant",
        integrationSurface: "cloudshare.v4.training.participant",
        method: "POST",
        path: "/v4/trainings/EXtraining-1/students",
        failureMode: "http_status",
        responseStatus: 403,
        requestBody: {
          email: "candidate@helioscx.demo",
          firstName: "Asha",
          lastName: "Patel",
        },
        responseBody: "{\"error\":\"forbidden\"}",
      }),
    );
    await expect(eventLog.listAll()).resolves.toEqual([
      expect.objectContaining({
        eventId: "corr-2",
        type: "cloudshare.schedule_exam.failed",
        payload: expect.objectContaining({
          correlationId: "corr-2",
          customerId: "customer-helios",
          examAttemptId: "attempt-1",
          operation: "schedule_exam",
          integrationSurface: "cloudshare.v4.training.participant",
          method: "POST",
          path: "/v4/trainings/EXtraining-1/students",
          failureMode: "http_status",
          responseStatus: 403,
          requestBody: {
            email: "candidate@helioscx.demo",
            firstName: "Asha",
            lastName: "Patel",
          },
          responseBody: "{\"error\":\"forbidden\"}",
        }),
      }),
    ]);
  });

  it("keeps later attempt states visible on the candidate dashboard", async () => {
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

    const dashboard = await handleGetCandidateDashboard(
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
          scoreRetrievalEnabled: false,
        },
      ],
      attempts: [
        {
          id: "attempt-in-progress",
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
          status: "in_progress",
        },
        {
          id: "attempt-completed",
          examId: "exam-1",
          scheduledFor: "2026-06-16T16:00:00.000Z",
          status: "completed",
        },
      ],
    });
  });

  it("reconciles an in-progress attempt to completed on the candidate dashboard when the portal-owned runtime is exhausted", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const clockRepository = createInMemoryExamClockRepository();
    const logger = makeLogger();
    let nowMs = new Date("2026-06-15T17:30:30.000Z").getTime();
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date(nowMs),
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

    const dashboard = await handleGetCandidateDashboard(
      {
        repository: exams,
        attempts,
        clocks,
        logger,
      },
      { customerId: "customer-helios", candidateId: "candidate-1" },
    );

    expect(dashboard.body).toEqual({
      exams: [
        {
          id: "exam-1",
          title: "Helios CloudShare Fundamentals",
          description: "Hands-on certification exam.",
          timeLimitMinutes: 90,
          scoreRetrievalEnabled: false,
        },
      ],
      attempts: [
        {
          id: "attempt-in-progress",
          examId: "exam-1",
          scheduledFor: "2026-06-15T16:00:00.000Z",
          status: "completed",
        },
      ],
    });
  });

  it("correlates a discoverable CloudShare envId through list-students and persists it for suspend/resume", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
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

    const dashboard = await handleGetCandidateDashboard(
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

  it("records admin-visible diagnostics when list-students correlation fails", async () => {
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

    const dashboard = await handleGetCandidateDashboard(
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

    const dashboard = await handleGetCandidateDashboard(
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
