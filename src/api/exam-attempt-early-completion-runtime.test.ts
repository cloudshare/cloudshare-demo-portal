import { describe, expect, it, vi } from "vitest";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { createDraftExam, publishExam } from "@/domain/exam-catalog";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createExamClock, createInMemoryExamClockRepository } from "@/domain/exam-clock";
import type { CloudShareClient } from "@/integrations/cloudshare";
import { CloudShareRateLimitError } from "@/integrations/cloudshare";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { CompleteExamAttemptEarlyHandlerDeps } from "./exam-attempt-early-completion-runtime";
import { completeExamAttemptEarlyRuntime } from "./exam-attempt-early-completion-runtime";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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

function makeCloudShareClient(): CloudShareClient {
  let environmentPolls = 0;
  return {
    requestV3Text: vi.fn(async (spec: { path: string }) => {
      if (spec.path === "/envs/actions/archive") {
        return "";
      }
      throw new Error(`unexpected v3 text path ${spec.path}`);
    }) as CloudShareClient["requestV3Text"],
    requestV3: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/envs/ENV-live-1") {
        environmentPolls += 1;
        return spec.schema.parse({ envStatus: environmentPolls === 1 ? "Ready" : "Archived" });
      }
      throw new Error(`unexpected v3 path ${spec.path}`);
    }) as CloudShareClient["requestV3"],
    requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/trainings/EXtraining-1/students") {
        return spec.schema.parse([
          {
            email: "candidate@helioscx.demo",
            envId: "ENV-live-1",
            envStatus: "Ready",
            participationStatus: "inProgress",
          },
        ]);
      }
      throw new Error(`unexpected v4 path ${spec.path}`);
    }) as CloudShareClient["requestV4"],
  } as CloudShareClient;
}

async function makeDeps(
  status: "ready" | "scheduled" | "in_progress" | "suspended" | "completed" | "expired" = "in_progress",
  cloudShareClient: CloudShareClient = makeCloudShareClient(),
): Promise<CompleteExamAttemptEarlyHandlerDeps> {
  const attempts = createInMemoryExamAttemptRepository();
  await attempts.save({
    id: "ea-1",
    customerId: "customer-1",
    candidateId: "candidate-1",
    examId: "exam-1",
    status,
    scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
    createdAt: new Date("2026-06-15T10:00:00.000Z"),
  });
  const launches = createInMemoryLabLaunchRepository();
  await launches.save({
    id: "launch-1",
    examAttemptId: "ea-1",
    candidateId: "candidate-1",
    participantEmail: "candidate@helioscx.demo",
    trainingId: "EXtraining-1",
    experienceId: "EXtraining-1",
    environmentExternalId: "ENV-live-1",
    loginUrl: "https://use.cloudshare.com/sponsored-link-secret",
    status: "launched",
    createdAt: new Date("2026-06-15T10:05:00.000Z"),
  });
  const clockRepository = createInMemoryExamClockRepository();
  await clockRepository.save({
    examAttemptId: "ea-1",
    status: "running",
    elapsedAtPauseMs: 5 * 60 * 1000,
    startedAt: new Date("2026-06-15T16:00:00.000Z"),
    updatedAt: new Date("2026-06-15T16:00:00.000Z"),
  });
  const cloudshare = {
    forConnection: vi.fn().mockReturnValue(cloudShareClient),
  } satisfies CloudShareClientFactory;

  return {
    controller: {
      suspendEnvironment: vi.fn(),
      resumeEnvironment: vi.fn(),
      archiveEnvironment: vi.fn(),
    },
    source: {
      getEnvironmentState: vi.fn(),
    },
    timer: createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-15T16:10:00.000Z"),
    }),
    clocks: createExamClock({
      clocks: clockRepository,
      now: () => new Date("2026-06-15T16:10:00.000Z"),
    }),
    attempts,
    launches,
    exams: await makeExams(),
    sleep: vi.fn().mockResolvedValue(undefined),
    logger: makeLogger(),
    eventLog: {
      append: vi.fn().mockResolvedValue(undefined),
      listFailureEventsByExamAttemptIds: vi.fn().mockResolvedValue([]),
      listByCustomerId: vi.fn(),
    },
    connections: makeConnections(),
    cloudshare,
    diagnostics: { record: vi.fn().mockResolvedValue(undefined) },
    candidateEmail: "candidate@helioscx.demo",
    newCorrelationId: () => "corr-complete",
    now: () => new Date("2026-06-15T16:10:00.000Z"),
  };
}

describe("completeExamAttemptEarlyRuntime", () => {
  it("archives an in-progress CloudShare lab before marking the ExamAttempt completed", async () => {
    const deps = await makeDeps();

    const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

    expect(response).toEqual({
      status: 200,
      body: { status: "completed", examAttemptId: "ea-1" },
    });
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "completed",
    });
    const client = vi.mocked(deps.cloudshare.forConnection).mock.results[0]?.value as CloudShareClient;
    expect(client.requestV3Text).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/archive",
        query: { envId: "ENV-live-1" },
      }),
    );
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "cloudshare.environment.archive",
        outcome: "success",
        externalIds: { environmentId: "ENV-live-1" },
      }),
    );
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "success",
        customerId: "customer-1",
        candidateEmail: "candidate@helioscx.demo",
        examId: "exam-1",
        examAttemptId: "ea-1",
        details: expect.objectContaining({
          completedBy: "candidate_early_completion",
          priorStatus: "in_progress",
        }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("sponsored-link-secret");
  });

  it("archives a suspended CloudShare lab before marking the ExamAttempt completed", async () => {
    const deps = await makeDeps("suspended");

    const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

    expect(response).toEqual({
      status: 200,
      body: { status: "completed", examAttemptId: "ea-1" },
    });
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "completed",
    });
    const client = vi.mocked(deps.cloudshare.forConnection).mock.results[0]?.value as CloudShareClient;
    expect(client.requestV3Text).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/envs/actions/archive",
        query: { envId: "ENV-live-1" },
      }),
    );
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "success",
        details: expect.objectContaining({
          completedBy: "candidate_early_completion",
          priorStatus: "suspended",
        }),
      }),
    );
  });

  it("keeps an in-progress ExamAttempt resumable when CloudShare cleanup is still pending", async () => {
    const pendingClient = {
      ...makeCloudShareClient(),
      requestV3Text: vi.fn(),
      requestV3: vi.fn(),
      requestV4: vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
        if (spec.path === "/trainings/EXtraining-1/students") {
          return spec.schema.parse([
            {
              email: "candidate@helioscx.demo",
              envId: "ENV-placeholder",
              envStatus: null,
              participationStatus: "pending",
            },
          ]);
        }
        throw new Error(`unexpected v4 path ${spec.path}`);
      }) as CloudShareClient["requestV4"],
    } as CloudShareClient;
    const deps = await makeDeps("in_progress", pendingClient);
    await deps.launches.save({
      id: "launch-1",
      examAttemptId: "ea-1",
      candidateId: "candidate-1",
      participantEmail: "candidate@helioscx.demo",
      trainingId: "EXtraining-1",
      experienceId: "EXtraining-1",
      loginUrl: "https://use.cloudshare.com/sponsored-link-secret",
      status: "launched",
      createdAt: new Date("2026-06-15T10:05:00.000Z"),
    });

    const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

    expect(response).toEqual({
      status: 202,
      body: {
        status: "pending",
        operation: "complete",
        examAttemptId: "ea-1",
        retryable: true,
        correlationId: "corr-complete",
        message: "CloudShare is still archiving your lab. Wait a few seconds, then retry End exam.",
      },
    });
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    expect(pendingClient.requestV3Text).not.toHaveBeenCalled();
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "failure",
        details: expect.objectContaining({
          completedBy: "candidate_early_completion",
          failureMode: "cleanup_not_confirmed",
          cleanupStatus: 202,
        }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("sponsored-link-secret");
  });

  it("keeps the response retryable and records diagnostics when completion persistence fails after cleanup", async () => {
    const deps = await makeDeps("in_progress");
    const originalSave = deps.attempts.save.bind(deps.attempts);
    deps.attempts.save = vi.fn(async (attempt) => {
      if (attempt.status === "completed") {
        throw new Error("database write failed");
      }
      await originalSave(attempt);
    });

    const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

    expect(response).toEqual({
      status: 202,
      body: {
        status: "pending",
        operation: "complete",
        examAttemptId: "ea-1",
        retryable: true,
        correlationId: "corr-complete",
        environmentArchived: true,
        message: "Your lab has been archived, but completion is still being saved. Retry End exam.",
      },
    });
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "failure",
        correlationId: "corr-complete",
        details: expect.objectContaining({
          completedBy: "candidate_early_completion",
          failureMode: "completion_persistence_failed",
          priorStatus: "in_progress",
          currentStatus: "in_progress",
          error: "database write failed",
        }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("sponsored-link-secret");
  });

  it("returns a non-retryable archive failure when the Customer CloudShare connection is missing", async () => {
    const deps = await makeDeps("in_progress");
    deps.connections.findByCustomerId = vi.fn().mockResolvedValue(null);

    const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

    expect(response).toEqual({
      status: 502,
      body: {
        error: "Unable to archive your CloudShare lab before ending the exam.",
        examAttemptId: "ea-1",
        operation: "complete",
        retryable: false,
        correlationId: "corr-complete",
      },
    });
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "cloudshare.environment.archive",
        outcome: "failure",
        correlationId: "corr-complete",
        details: expect.objectContaining({
          attemptedOperation: "archive_environment",
          failureMode: "runtime_state",
          error: "No stored CloudShare connection exists for the exam attempt customer.",
        }),
      }),
    );
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "failure",
        details: expect.objectContaining({
          failureMode: "cleanup_not_confirmed",
          cleanupStatus: 502,
        }),
      }),
    );
  });

  it("returns a retryable 429 and rate-limit diagnostics when CloudShare throttles archive", async () => {
    const throttledClient = {
      ...makeCloudShareClient(),
      requestV3Text: vi.fn(async () => {
        throw new CloudShareRateLimitError("CloudShare rate limit exceeded", 429, "rate_limit", {
          retryAfterSeconds: 45,
          retryAfter: "45",
          rateLimitHeaders: { "retry-after": "45", "x-ratelimit-limit": "10" },
          responseHeaders: { "retry-after": "45", "x-ratelimit-limit": "10" },
          responseBody: { error: "too many requests" },
        });
      }) as CloudShareClient["requestV3Text"],
    } as CloudShareClient;
    const deps = await makeDeps("in_progress", throttledClient);

    const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

    expect(response).toEqual({
      status: 429,
      body: {
        error: "Something is not working right now. Contact your instructor before trying again.",
        examAttemptId: "ea-1",
        operation: "complete",
        retryable: true,
        correlationId: "corr-complete",
      },
    });
    await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
      status: "in_progress",
    });
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "cloudshare.environment.archive",
        outcome: "failure",
        correlationId: "corr-complete",
        details: expect.objectContaining({
          attemptedOperation: "archive_environment",
          integrationSurface: "cloudshare.v3.env.action.archive",
          failureMode: "rate_limit",
          responseStatus: 429,
          retryAfterSeconds: 45,
          responseHeaders: { "retry-after": "45", "x-ratelimit-limit": "10" },
        }),
      }),
    );
    expect(deps.diagnostics?.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "exam_attempt.complete",
        outcome: "failure",
        details: expect.objectContaining({
          failureMode: "cleanup_not_confirmed",
          cleanupStatus: 429,
        }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("sponsored-link-secret");
  });

  it.each(["ready", "scheduled", "expired", "completed"] as const)(
    "rejects early completion for a %s ExamAttempt without touching CloudShare",
    async (status) => {
      const deps = await makeDeps(status);

      const response = await completeExamAttemptEarlyRuntime(deps, { examAttemptId: "ea-1" });

      expect(response).toEqual({
        status: 409,
        body: {
          error: "Exam completion is not available for this attempt.",
          examAttemptId: "ea-1",
          operation: "complete",
          currentStatus: status,
        },
      });
      await expect(deps.attempts.findById("ea-1")).resolves.toMatchObject({
        status,
      });
      expect(deps.cloudshare.forConnection).not.toHaveBeenCalled();
      expect(deps.diagnostics?.record).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "exam_attempt.complete",
          outcome: "failure",
          details: expect.objectContaining({
            completedBy: "candidate_early_completion",
            failureMode: "invalid_status",
            currentStatus: status,
          }),
        }),
      );
    },
  );
});
