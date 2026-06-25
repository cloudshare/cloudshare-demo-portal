import { describe, expect, it, vi } from "vitest";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { Logger } from "@/observability/logger";
import { scheduleExamAttemptRuntime } from "./exam-attempt-scheduling-runtime";

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

function makeCloudShareFactory(
  overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> = {},
): CloudShareClientFactory {
  const requestV3 =
    (overrides.requestV3 as
      | ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"]
      | undefined) ??
    (vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/teams") {
        return spec.schema.parse({ rows: [{ id: "TM-team-1", name: "Helios Team" }] });
      }
      throw new Error(`unexpected v3 path ${spec.path}`);
    }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"]);

  const requestV4 =
    (overrides.requestV4 as
      | ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"]
      | undefined) ??
    (vi.fn(async (spec: { path: string }) => {
      if (spec.path === "/trainings") {
        return { id: "EXtraining-1" };
      }
      if (spec.path === "/trainings/EXtraining-1/students") {
        return [
          {
            email: "candidate@helioscx.demo",
            firstName: "Asha",
            lastName: "Patel",
          },
        ];
      }
      if (spec.path === "/trainings/EXtraining-1/sponsored-link") {
        return {
          loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
        };
      }
      throw new Error(`unexpected path ${spec.path}`);
    }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4"]);

  const requestV4Detailed =
    (overrides.requestV4Detailed as
      | ReturnType<CloudShareClientFactory["forConnection"]>["requestV4Detailed"]
      | undefined) ??
    (vi.fn(
      async (spec: {
        method: string;
        path: string;
        body?: unknown;
        schema: { parse(value: unknown): unknown };
      }) => {
        const raw = await (requestV4 as unknown as (spec: { path: string }) => Promise<unknown>)(
          spec,
        );
        const data = spec.schema.parse(raw);
        return {
          data,
          host: "api.accelerate.cloudshare.com",
          integrationSurface:
            spec.path === "/trainings"
              ? "cloudshare.v4.training"
              : spec.path.endsWith("/students")
                ? "cloudshare.v4.training.participant"
                : spec.path.endsWith("/sponsored-link")
                  ? "cloudshare.v4.training.sponsored_link"
                  : "cloudshare.v4",
          request: {
            method: spec.method,
            path: spec.path,
            ...(spec.body !== undefined ? { body: spec.body } : {}),
          },
          response: {
            status: 200,
            body: raw,
          },
        };
      },
    ) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV4Detailed"]);

  return {
    forConnection: vi.fn(() => ({
      requestV3,
      requestV3Text: vi.fn(),
      requestV4,
      requestV4Detailed,
      ...overrides,
    })),
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

describe("ExamAttempt scheduling runtime", () => {
  it("schedules an ExamAttempt without exposing the sponsored loginUrl", async () => {
    const exams = await makeExamRepository();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const audit = createInMemoryAuditRepository();
    const eventLog = createInMemoryEventLogRepository();
    const logger = makeLogger();

    const response = await scheduleExamAttemptRuntime(
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
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-1",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: "2026-06-15T16:00:00.000Z",
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
      }),
    ]);
  });

  it("returns 409 before provisioning when the Customer has no CloudShare connection", async () => {
    const cloudshare = makeCloudShareFactory();

    const response = await scheduleExamAttemptRuntime(
      {
        exams: await makeExamRepository(),
        attempts: createInMemoryExamAttemptRepository(),
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(null),
        cloudshare,
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: "2026-06-15T16:00:00.000Z",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: { error: "CloudShare is not connected for this customer." },
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
  });
});
