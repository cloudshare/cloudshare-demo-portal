import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import type { Logger } from "@/observability/logger";
import { handleEnterExam } from "./enter";
import type { ExamTimer } from "@/domain/exam-attempt-runtime-lifecycle";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type {
  CloudShareDetailedResult,
  V4RequestSpec,
} from "@/integrations/cloudshare/client";
import { CloudShareRequestError } from "@/integrations/cloudshare";
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

function makeConnections(): CloudShareConnectionRepository {
  return {
    save: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue({
      customerId: "customer-1",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "whsec",
      webhookPathToken: "whk-customer-1",
      connectedAt: new Date("2026-06-15T08:00:00.000Z"),
      verifiedAt: new Date("2026-06-15T08:05:00.000Z"),
    }),
    findByWebhookPathToken: vi.fn(),
    markVerified: vi.fn(),
  };
}

function makeCloudShareFactory(
  requestV3: ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"],
): CloudShareClientFactory {
  return {
    forConnection: () => ({
      requestV3,
      requestV3Text: vi.fn(),
      requestV4: vi.fn(),
      requestV4Detailed: vi.fn(),
    }),
  };
}

describe("handleEnterExam", () => {
  async function seedExam(exams = createInMemoryExamCatalogRepository()) {
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
        openPeriodMinutes: 120,
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

  it("refuses entry before the scheduled time without leaking the sponsored loginUrl", async () => {
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

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T15:59:59.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual("Exam entry is not available before the scheduled start time.");
    expect(JSON.stringify(response)).not.toContain("loginUrl");
    expect(response.headers.location).toBeUndefined();
  });

  it("redirects to the sponsored link within the launch window", async () => {
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

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        timer,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    );
    expect(response.body).toBe("Redirecting to the CloudShare lab.");
    expect(timer.resumed).toEqual(["attempt-1"]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("recomputes ownership server-side and denies another candidate", async () => {
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

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-2" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toBe("Exam entry is not allowed for this candidate.");
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("blocks entry for an expired failed provisioning attempt before any launch lookup", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();

    await attempts.save({
      id: "attempt-failed",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "expired",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:05:00.000Z"),
      },
      { examAttemptId: "attempt-failed", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toBe("Exam entry is not available for this attempt.");
  });

  it("redirects during the authored open window even when CloudShare environment readback would report expired", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const exams = await seedExam();
    const timer = makeTimer();
    const requestV3 = vi.fn(async (spec: { path: string }) => {
      if (spec.path === "/envs/ENVS-expired-1") {
        throw new CloudShareRequestError("not found", 404, {
          method: "GET",
          path: "/v3/envs/ENVS-expired-1",
          integrationSurface: "cloudshare.v3.env.get",
        });
      }
      throw new Error(`unexpected path ${spec.path}`);
    });

    await attempts.save({
      id: "attempt-expired-env",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-expired-env",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      environmentExternalId: "ENVS-expired-1",
      environmentId: "ENVS-expired-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        exams,
        timer,
        connections: makeConnections(),
        cloudshare: makeCloudShareFactory(requestV3 as never),
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-expired-env", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    );
    expect(response.body).toBe("Redirecting to the CloudShare lab.");
    expect(requestV3).not.toHaveBeenCalled();
    expect(response.body).not.toContain("secret");
    expect(timer.resumed).toEqual(["attempt-expired-env"]);
    await expect(attempts.findById("attempt-expired-env")).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("redirects during the authored open window even when CloudShare training readback would report an elapsed End", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const exams = await seedExam();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const timer = makeTimer();
    const requestV4Detailed = vi.fn().mockImplementation(
      async <T>(spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>> => {
        if (spec.path === "/trainings/EXtraining-1") {
          return {
            data: {
              id: "EXtraining-1",
              end: "2026-06-15T15:59:00.000Z",
              status: "active",
            } as T,
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.get",
            request: {
              method: spec.method,
              path: `/v4${spec.path}`,
            },
            response: {
              status: 200,
              body: {
                id: "EXtraining-1",
                end: "2026-06-15T15:59:00.000Z",
                status: "active",
              },
            },
          };
        }
        throw new Error(`unexpected path ${spec.path}`);
      },
    );

    await attempts.save({
      id: "attempt-expired-training",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-expired-training",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        exams,
        timer,
        connections: makeConnections(),
        cloudshare: {
          forConnection: () => ({
            requestV3: vi.fn(),
            requestV3Text: vi.fn(),
            requestV4: vi.fn(),
            requestV4Detailed,
          }),
        },
        diagnostics,
        candidateEmail: "candidate@helioscx.demo",
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:00.000Z"),
      },
      { examAttemptId: "attempt-expired-training", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
    );
    expect(response.body).toBe("Redirecting to the CloudShare lab.");
    expect(requestV4Detailed).not.toHaveBeenCalled();
    expect(timer.resumed).toEqual(["attempt-expired-training"]);
    await expect(attempts.findById("attempt-expired-training")).resolves.toMatchObject({
      status: "in_progress",
    });
    await expect(
      diagnosticsRepository.query({ examAttemptId: "attempt-expired-training" }),
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.expired",
        }),
      ]),
    );
  });

  it("reconciles an experience-only CloudShare training id after the authored open period closes", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const exams = await seedExam();

    await attempts.save({
      id: "attempt-expired-experience-only",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId: "attempt-expired-experience-only",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const requestV4Detailed = vi.fn().mockImplementation(
      async <T>(spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>> => {
        if (spec.path === "/trainings/EXtraining-1") {
          return {
            data: {
              id: "EXtraining-1",
              end: "2026-06-15T15:59:00.000Z",
              status: "active",
            } as T,
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.get",
            request: {
              method: spec.method,
              path: `/v4${spec.path}`,
            },
            response: {
              status: 200,
              body: {
                id: "EXtraining-1",
                end: "2026-06-15T15:59:00.000Z",
                status: "active",
              },
            },
          };
        }
        throw new Error(`unexpected path ${spec.path}`);
      },
    );

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        exams,
        connections: makeConnections(),
        cloudshare: {
          forConnection: () => ({
            requestV3: vi.fn(),
            requestV3Text: vi.fn(),
            requestV4: vi.fn(),
            requestV4Detailed,
          }),
        },
        logger: makeLogger(),
        now: () => new Date("2026-06-15T18:00:00.000Z"),
      },
      { examAttemptId: "attempt-expired-experience-only", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(409);
    expect(response.body).toBe(
      "Exam entry is no longer available because the CloudShare lab has expired.",
    );
    expect(requestV4Detailed).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/trainings/EXtraining-1",
      }),
    );
    await expect(attempts.findById("attempt-expired-experience-only")).resolves.toMatchObject({
      status: "expired",
    });
  });

  it("reconciles runtime exhaustion before redirect and completes the attempt instead of entering", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const exams = await seedExam();
    const clockRepository = createInMemoryExamClockRepository();
    const timer = makeTimer();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const clocks = createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-15T16:00:30.000Z"),
    });

    await attempts.save({
      id: "attempt-1",
      customerId: "customer-1",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await clockRepository.save({
      examAttemptId: "attempt-1",
      status: "running",
      elapsedAtPauseMs: 59 * 60 * 1000,
      startedAt: new Date("2026-06-15T15:59:30.000Z"),
      updatedAt: new Date("2026-06-15T15:59:30.000Z"),
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

    const response = await handleEnterExam(
      {
        attempts,
        launches,
        exams,
        clocks,
        timer,
        diagnostics,
        candidateEmail: "candidate@helioscx.demo",
        logger: makeLogger(),
        now: () => new Date("2026-06-15T16:00:30.000Z"),
      },
      { examAttemptId: "attempt-1", candidateId: "candidate-1" },
    );

    expect(response.status).toBe(403);
    expect(response.body).toBe("Exam entry is not available for this attempt.");
    expect(response.headers.location).toBeUndefined();
    expect(timer.resumed).toEqual([]);
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      status: "completed",
    });
    await expect(
      diagnosticsRepository.query({ examAttemptId: "attempt-1" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "exam_attempt.complete",
          outcome: "success",
          customerId: "customer-1",
          candidateEmail: "candidate@helioscx.demo",
          examAttemptId: "attempt-1",
        }),
      ]),
    );
  });

  it("treats concurrent fast enter requests as a single transition and redirects both callers", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const examAttemptId = "attempt-coalesce";
    const releaseTimerResume: { current: undefined | (() => void) } = { current: undefined };
    const timer = {
      resumed: [] as string[],
      pauseTimer: vi.fn().mockResolvedValue(undefined),
      resumeTimer: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            timer.resumed.push(examAttemptId);
            releaseTimerResume.current = resolve;
          }),
      ),
    } satisfies ExamTimer & { resumed: string[] };

    await attempts.save({
      id: examAttemptId,
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId,
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const deps = {
      attempts,
      launches,
      timer,
      logger: makeLogger(),
      now: () => new Date("2026-06-15T16:00:00.000Z"),
    };

    const first = handleEnterExam(deps, {
      examAttemptId,
      candidateId: "candidate-1",
    });
    const second = handleEnterExam(deps, {
      examAttemptId,
      candidateId: "candidate-1",
    });

    try {
      await vi.waitFor(() => {
        expect(timer.resumeTimer).toHaveBeenCalledTimes(1);
      });

      if (releaseTimerResume.current) {
        releaseTimerResume.current();
      }

      await expect(first).resolves.toMatchObject({
        status: 302,
        body: "Redirecting to the CloudShare lab.",
      });
      await expect(second).resolves.toMatchObject({
        status: 302,
        body: "Redirecting to the CloudShare lab.",
      });
      expect(timer.resumed).toEqual([examAttemptId]);
      await expect(attempts.findById(examAttemptId)).resolves.toMatchObject({
        status: "in_progress",
      });
    } finally {
      if (releaseTimerResume.current) {
        releaseTimerResume.current();
      }
    }
  });

  it("does not share an authorized in-flight enter redirect with another candidate", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const examAttemptId = "attempt-owner-only";
    const releaseTimerResume: { current: undefined | (() => void) } = { current: undefined };
    const timer = {
      resumed: [] as string[],
      pauseTimer: vi.fn().mockResolvedValue(undefined),
      resumeTimer: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            timer.resumed.push(examAttemptId);
            releaseTimerResume.current = resolve;
          }),
      ),
    } satisfies ExamTimer & { resumed: string[] };

    await attempts.save({
      id: examAttemptId,
      customerId: "customer-1",
      candidateId: "candidate-owner",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    await launches.save({
      id: "launch-1",
      examAttemptId,
      candidateId: "candidate-owner",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "training-1",
      experienceId: "training-1",
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const deps = {
      attempts,
      launches,
      timer,
      logger: makeLogger(),
      now: () => new Date("2026-06-15T16:00:00.000Z"),
    };

    const ownerRequest = handleEnterExam(deps, {
      examAttemptId,
      candidateId: "candidate-owner",
    });

    try {
      await vi.waitFor(() => {
        expect(timer.resumeTimer).toHaveBeenCalledTimes(1);
      });

      const attackerResponse = await handleEnterExam(deps, {
        examAttemptId,
        candidateId: "candidate-attacker",
      });

      expect(attackerResponse.status).toBe(403);
      expect(attackerResponse.body).toBe("Exam entry is not allowed for this candidate.");
      expect(attackerResponse.headers.location).toBeUndefined();
      expect(JSON.stringify(attackerResponse)).not.toContain("secret");

      if (releaseTimerResume.current) {
        releaseTimerResume.current();
      }

      await expect(ownerRequest).resolves.toMatchObject({
        status: 302,
        headers: expect.objectContaining({
          location: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/secret",
        }),
      });
    } finally {
      if (releaseTimerResume.current) {
        releaseTimerResume.current();
      }
    }
  });
});
