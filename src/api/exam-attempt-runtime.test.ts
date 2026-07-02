import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import type { Logger } from "@/observability/logger";
import type { ExamTimer } from "@/domain/exam-attempt-runtime-lifecycle";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { enterExamAttemptRuntime } from "./exam-attempt-runtime";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeTimer(): ExamTimer & { resumed: string[] } {
  const resumed: string[] = [];
  return {
    resumed,
    pauseTimer: vi.fn().mockResolvedValue(undefined),
    resumeTimer: vi.fn(async (examAttemptId: string) => {
      resumed.push(examAttemptId);
    }),
  };
}

function makeConnectionRepository(
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

function makeCloudShareFactory(
  overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> = {},
): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3: vi.fn(),
      requestV3Text: vi.fn(),
      requestV4: vi.fn(),
      requestV4Detailed: vi.fn(),
      ...overrides,
    }),
  };
}

describe("enterExamAttemptRuntime", () => {
  it("returns a typed redirect result and starts a ready ExamAttempt", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const timer = makeTimer();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toEqual({
      kind: "redirect",
      location: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      body: "Redirecting to the CloudShare lab.",
    });
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("blocks entry before scheduled time without exposing the sponsored link", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T15:59:59.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toEqual({
      kind: "blocked",
      status: 403,
      body: { message: "Exam entry is not available before the scheduled start time." },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("allows an in-progress ExamAttempt to re-enter and resumes the clock idempotently", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const timer = makeTimer();

    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:05:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toMatchObject({
      kind: "redirect",
      location: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    });
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("blocks entry after the authored Exam open period without resuming the clock or exposing the sponsored link", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const exams = createInMemoryExamCatalogRepository();
    const launches = createInMemoryLabLaunchRepository();
    const timer = makeTimer();

    await exams.save({
      id: "exam-1",
      customerId: "customer-1",
      title: "Helios Fundamentals",
      description: "",
      timeLimitMinutes: 60,
      storageLeaseMinutes: 1440,
      openPeriodMinutes: 120,
      scoreRetrievalEnabled: true,
      status: "published",
      publishedAt: new Date("2026-06-15T10:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
      updatedAt: new Date("2026-06-15T10:00:00.000Z"),
      projectId: "project-1",
      projectName: "Project 1",
      blueprintId: "blueprint-1",
      blueprintName: "Blueprint 1",
      snapshotId: "snapshot-1",
      snapshotName: "Snapshot 1",
      allowedRegions: [{ id: "region-1", name: "Region 1" }],
      policyId: "policy-1",
      policyName: "Policy 1",
      instructorId: "instructor-1",
      instructorName: "Instructor 1",
    });
    await attempts.save({
      id: "attempt-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "in_progress",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        exams,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T18:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toEqual({
      kind: "blocked",
      status: 403,
      body: { message: "Exam entry is not available after the Exam open period has closed." },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(timer.resumed).toEqual([]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("allows entry during the authored open period even when CloudShare training readback says ended", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const exams = createInMemoryExamCatalogRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const timer = makeTimer();
    const requestV4Detailed = vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/trainings/training-1") {
        return {
          data: spec.schema.parse({
            id: "training-1",
            start: "2026-06-15T16:00:00",
            end: "2026-06-15T16:05:00",
            status: "ended",
          }),
          integrationSurface: "cloudshare.v4.training.get",
          host: "api.accelerate.cloudshare.com",
          request: { method: "GET" as const, path: "/v4/trainings/training-1" },
          response: { status: 200, body: { status: "ended" } },
        };
      }
      throw new Error(`unexpected path ${spec.path}`);
    });

    await exams.save({
      id: "exam-1",
      customerId: "customer-1",
      title: "Helios Fundamentals",
      description: "",
      timeLimitMinutes: 10,
      storageLeaseMinutes: 1440,
      openPeriodMinutes: 30,
      scoreRetrievalEnabled: true,
      status: "published",
      publishedAt: new Date("2026-06-15T10:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
      updatedAt: new Date("2026-06-15T10:00:00.000Z"),
      projectId: "project-1",
      projectName: "Project 1",
      blueprintId: "blueprint-1",
      blueprintName: "Blueprint 1",
      snapshotId: "snapshot-1",
      snapshotName: "Snapshot 1",
      allowedRegions: [{ id: "region-1", name: "Region 1" }],
      policyId: "policy-1",
      policyName: "Policy 1",
      instructorId: "instructor-1",
      instructorName: "Instructor 1",
    });
    await attempts.save({
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:09:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const result = await enterExamAttemptRuntime(
      {
        attempts,
        exams,
        launches,
        timer,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({ requestV4Detailed: requestV4Detailed as never }),
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:12:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(result).toMatchObject({
      kind: "redirect",
      location: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    await expect(diagnosticsRepository.query({ examAttemptId: "attempt-1" })).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.expired",
        }),
      ]),
    );
  });

  it("records a support diagnostic when clock resume fails", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const timer: ExamTimer = {
      pauseTimer: vi.fn().mockResolvedValue(undefined),
      resumeTimer: vi.fn().mockRejectedValue(new Error("clock unavailable")),
    };

    await attempts.save({
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    await expect(
      enterExamAttemptRuntime(
        {
          attempts,
          launches,
          timer,
          diagnostics,
          candidateEmail: "candidate@helioscx.demo",
          logger: makeLogger(),
          now: () => new Date("2026-06-15T16:00:00.000Z"),
        },
        { examAttemptId: "attempt-1", candidateId: "candidate-1" },
      ),
    ).rejects.toThrow("clock unavailable");

    await expect(diagnosticsRepository.query({ examAttemptId: "attempt-1" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.enter",
          outcome: "failure",
          customerId: "customer-1",
          candidateEmail: "candidate@helioscx.demo",
          examId: "exam-1",
          examAttemptId: "attempt-1",
          message: "Exam entry failed while resuming the portal clock",
          details: expect.objectContaining({
            attemptStatus: "ready",
            failureMode: "clock_resume_failed",
            error: "clock unavailable",
          }),
        }),
      ]),
    );
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "ready",
    });
  });
});
