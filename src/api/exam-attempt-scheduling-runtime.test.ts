import { describe, expect, it, vi } from "vitest";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
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
import { CloudShareRateLimitError } from "@/integrations/cloudshare";
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
    storageLeaseMinutes: 90,
    openPeriodMinutes: 90,
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
  overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> & {
    listProjects?: () => Promise<unknown>;
    getBlueprintDetail?: (projectId: string, blueprintId: string) => Promise<unknown>;
  } = {},
): CloudShareClientFactory {
  const requestV3 =
    (overrides.requestV3 as
      | ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"]
      | undefined) ??
    (vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/teams") {
        return spec.schema.parse({ rows: [{ id: "TM-team-1", name: "Helios Team" }] });
      }
      if (spec.path === "/projects/project-1/blueprints/bp-1") {
        return spec.schema.parse({
          id: "bp-1",
          name: "Helios Exam Blueprint",
          snapshots: [
            {
              id: "snap-1",
              name: "Default Snapshot",
              isDefault: true,
              regions: [{ id: "region-1", name: "EU West" }],
            },
          ],
        });
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
      listProjects: vi.fn(async () => []),
      getBlueprintDetail: vi.fn(async () => ({
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "",
        defaultSnapshotId: "snap-1",
        snapshots: [
          { id: "snap-1", name: "Default Snapshot", isDefault: true, regionIds: ["region-1"] },
        ],
      })),
      requestV3,
      requestV3Text: vi.fn(),
      requestV4,
      requestV4Detailed,
      ...overrides,
    })),
  };
}

async function makeExamRepository(overrides: Partial<CreateDraftExamInput> = {}) {
  const exams = createInMemoryExamCatalogRepository();
  await createDraftExam(
    { repository: exams, now: () => new Date("2026-06-15T09:00:00.000Z"), newId: () => "exam-1" },
    makeExamInput(overrides),
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

  it("uses the Exam open period for the CloudShare create-training End", async () => {
    const requestV4Detailed = vi.fn(
      async (spec: {
        method: string;
        path: string;
        body?: unknown;
        schema: { parse(value: unknown): unknown };
      }) => {
        const raw =
          spec.path === "/trainings"
            ? { id: "EXtraining-1" }
            : spec.path === "/trainings/EXtraining-1/students"
              ? [{ email: "candidate@helioscx.demo", firstName: "Asha", lastName: "Patel" }]
              : spec.path === "/trainings/EXtraining-1/sponsored-link"
                ? {
                    loginUrl:
                      "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/demo",
                  }
                : null;
        if (!raw) {
          throw new Error(`unexpected path ${spec.path}`);
        }
        return {
          data: spec.schema.parse(raw),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training",
          request: {
            method: spec.method,
            path: spec.path,
            ...(spec.body !== undefined ? { body: spec.body } : {}),
          },
          response: { status: 200, body: raw },
        };
      },
    );
    const exams = await makeExamRepository({
      timeLimitMinutes: 10,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 60,
    });

    const response = await scheduleExamAttemptRuntime(
      {
        exams,
        attempts: createInMemoryExamAttemptRepository(),
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV4Detailed:
            requestV4Detailed as unknown as ReturnType<
              CloudShareClientFactory["forConnection"]
            >["requestV4Detailed"],
        }),
        logger: makeLogger(),
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
    expect(requestV4Detailed).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/trainings",
        body: expect.objectContaining({
          Start: "2026-06-15T16:00:00.000Z",
          End: "2026-06-15T17:00:00.000Z",
        }),
      }),
    );
    await expect(exams.findById("exam-1")).resolves.toMatchObject({
      timeLimitMinutes: 10,
      storageLeaseMinutes: 2880,
      openPeriodMinutes: 60,
    });
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

  it("rejects cohort-only Exams before individual CloudShare provisioning", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const connections = makeConnectionRepository();
    const cloudshare = makeCloudShareFactory();

    const response = await scheduleExamAttemptRuntime(
      {
        exams: await makeExamRepository({ deliveryAvailability: "cohort" }),
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections,
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
      status: 404,
      body: { error: "Published exam not found." },
    });
    expect(connections.findByCustomerId).not.toHaveBeenCalled();
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toEqual([]);
  });

  it("returns candidate-facing copy when the requested schedule time is not in the future", async () => {
    const response = await scheduleExamAttemptRuntime(
      {
        exams: await makeExamRepository(),
        attempts: createInMemoryExamAttemptRepository(),
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory(),
        logger: makeLogger(),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: "2026-06-15T09:59:00.000Z",
      },
    );

    expect(response).toEqual({
      status: 400,
      body: { error: "Choose a future date and time before scheduling." },
    });
  });

  it("returns 409 with next available time before CloudShare provisioning when the requested window overlaps an existing attempt", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    const requestV3 = vi.fn();
    const requestV4Detailed = vi.fn();

    const response = await scheduleExamAttemptRuntime(
      {
        exams: await makeExamRepository(),
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV3: requestV3 as unknown as ReturnType<
            CloudShareClientFactory["forConnection"]
          >["requestV3"],
          requestV4Detailed: requestV4Detailed as unknown as ReturnType<
            CloudShareClientFactory["forConnection"]
          >["requestV4Detailed"],
        }),
        logger: makeLogger(),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
        newId: vi.fn(),
        newCorrelationId: () => "corr-overlap-1",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        scheduledFor: "2026-06-15T15:00:00.000Z",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error:
          "Another attempt for this Exam is still active or available. You can schedule this Exam again after 2026-06-15T17:30:00.000Z.",
        code: "exam_attempt_overlap",
        nextAvailableAt: "2026-06-15T17:30:00.000Z",
      },
    });
    expect(requestV3).not.toHaveBeenCalled();
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toHaveLength(1);
  });

  it("blocks scheduling before creating an individual Experience when the Blueprint default Snapshot drifted", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const getBlueprintDetail = vi.fn(async () => ({
      id: "bp-1",
      name: "Helios Exam Blueprint",
      description: "",
      defaultSnapshotId: "snap-2",
      snapshots: [
        { id: "snap-1", name: "Default Snapshot", isDefault: false, regionIds: ["region-1"] },
        { id: "snap-2", name: "Changed Default Snapshot", isDefault: true, regionIds: ["region-1"] },
      ],
    }));
    const requestV4Detailed = vi.fn();

    const response = await scheduleExamAttemptRuntime(
      {
        exams: await makeExamRepository(),
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          getBlueprintDetail,
          requestV4Detailed: requestV4Detailed as unknown as ReturnType<
            CloudShareClientFactory["forConnection"]
          >["requestV4Detailed"],
        }),
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
        newId: vi.fn(),
        newCorrelationId: () => "corr-snapshot-drift-schedule",
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
      status: 423,
      body: {
        error:
          "Exam scheduling is temporarily unavailable because the lab configuration changed. Contact your instructor.",
        correlationId: "corr-snapshot-drift-schedule",
      },
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toEqual([]);
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-helios",
      examId: "exam-1",
      operation: "exam_attempt.schedule",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-snapshot-drift-schedule",
      subject: { type: "exam", id: "exam-1" },
      details: {
        failureMode: "snapshot_drift",
        savedSnapshotId: "snap-1",
        currentDefaultSnapshotId: "snap-2",
      },
    });
  });

  it("returns a rate-limited response instead of misleading snapshot drift when the Blueprint lookup is throttled", async () => {
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const getBlueprintDetail = vi.fn(async () => {
      throw new CloudShareRateLimitError(
        "CloudShare rate limited blueprint detail",
        429,
        "rate_limit",
        {
          method: "GET",
          path: "/api/v3/projects/project-1/blueprints/bp-1",
          integrationSurface: "cloudshare.v3.projects.blueprint_detail",
          responseHeaders: { "retry-after": "12" },
        },
      );
    });
    const requestV4Detailed = vi.fn();

    const response = await scheduleExamAttemptRuntime(
      {
        exams: await makeExamRepository(),
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          getBlueprintDetail,
          requestV4Detailed: requestV4Detailed as unknown as ReturnType<
            CloudShareClientFactory["forConnection"]
          >["requestV4Detailed"],
        }),
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-06-15T10:00:00.000Z"),
        newId: vi.fn(),
        newCorrelationId: () => "corr-snapshot-rate-limit-schedule",
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
      status: 429,
      body: {
        error:
          "CloudShare is returning a 429 error stating that you need to contact support@cloudshare.com. This is likely CloudShare rate limiting or abuse protection blocking the request. Check whether this public IP needs CloudShare allow-list or abuse-list review before retrying.",
        correlationId: "corr-snapshot-rate-limit-schedule",
      },
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(attempts.listByCandidate("candidate-1")).resolves.toEqual([]);
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-helios",
      examId: "exam-1",
      operation: "exam_attempt.schedule",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-snapshot-rate-limit-schedule",
      details: {
        failureMode: "snapshot_guard_unavailable",
        integrationFailureMode: "rate_limit",
      },
      response: {
        status: 429,
        headers: {
          "retry-after": "12",
        },
      },
    });
  });
});
