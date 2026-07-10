import { describe, expect, it, vi } from "vitest";
import { createInMemoryAuditRepository } from "@/persistence/audit-repository";
import { createInMemoryCohortExamSessionRepository } from "@/persistence/cohort-exam-session-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryEventLogRepository } from "@/persistence/event-log-repository";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { createDraftCohortExamSession, markCohortExamSessionPublished } from "@/domain/cohort-exam-session";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  DuplicateCohortExamAttemptError,
  SameExamAttemptAvailabilityConflictError,
  type ExamAttemptRepository,
} from "@/domain/exam-attempt";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { CloudShareExamAuthoringSource } from "@/integrations/cloudshare/resources";
import {
  CloudShareRateLimitError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import type { Logger } from "@/observability/logger";
import { joinCohortExamSessionRuntime } from "./cohort-exam-session-join-runtime";

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
    title: "Helios Shared Lab Exam",
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
    deliveryAvailability: "cohort",
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
    connectedAt: new Date("2026-07-05T08:00:00.000Z"),
    verifiedAt: new Date("2026-07-05T08:05:00.000Z"),
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
  overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> &
    Partial<CloudShareExamAuthoringSource> = {},
): CloudShareClientFactory {
  const source = makeAuthoringSource();
  const requestV3 =
    (overrides.requestV3 as ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"] | undefined) ??
    (vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([]),
    ) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"]);
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
        const raw =
          spec.path === "/trainings/EXcohort-1"
            ? {
                id: "EXcohort-1",
                status: "notStarted",
                start: "2026-07-05T08:30:00",
                timeZone: "UTC",
              }
            : spec.method === "GET" && spec.path === "/trainings/EXcohort-1/users/properties"
              ? []
              : spec.method === "POST" && spec.path === "/trainings/EXcohort-1/users/properties"
                ? { id: (spec.body as { Name?: string } | undefined)?.Name, name: (spec.body as { Name?: string } | undefined)?.Name }
                : spec.path === "/trainings/EXcohort-1/students"
                  ? [{}]
                  : spec.path === "/trainings/EXcohort-1/sponsored-link"
                    ? {
                        loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/cohort",
                      }
                    : null;
        if (!raw) {
          throw new Error(`unexpected path ${spec.path}`);
        }
        return {
          data: spec.schema.parse(raw),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: spec.path.endsWith("/students")
            ? "cloudshare.v4.training.participant"
            : spec.path.endsWith("/sponsored-link")
              ? "cloudshare.v4.training.sponsored_link"
              : spec.path.endsWith("/users/properties")
                ? "cloudshare.v4.training.user_properties"
                : "cloudshare.v4.training.get",
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
      ...source,
      requestV3,
      requestV3Text: vi.fn(),
      requestV4: vi.fn(),
      requestV4Detailed,
      ...overrides,
    })),
  };
}

function makeAuthoringSource(
  overrides: Partial<CloudShareExamAuthoringSource> = {},
): CloudShareExamAuthoringSource {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    listRegions: vi.fn().mockResolvedValue([]),
    listProjectBlueprints: vi.fn().mockResolvedValue([]),
    listProjectPolicies: vi.fn().mockResolvedValue([]),
    getBlueprintDetail: vi.fn().mockResolvedValue({
      id: "bp-1",
      name: "Helios Exam Blueprint",
      description: "",
      defaultSnapshotId: "snap-1",
      snapshots: [
        {
          id: "snap-1",
          name: "Default Snapshot",
          isDefault: true,
          regionIds: ["region-1"],
        },
      ],
    }),
    ...overrides,
  };
}

async function makeExamRepository() {
  const exams = createInMemoryExamCatalogRepository();
  await createDraftExam(
    { repository: exams, now: () => new Date("2026-07-05T09:00:00.000Z"), newId: () => "exam-1" },
    makeExamInput(),
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-07-05T09:05:00.000Z") },
    { customerId: "customer-helios", examId: "exam-1" },
  );
  return exams;
}

async function makePublishedSession() {
  const sessions = createInMemoryCohortExamSessionRepository();
  const draft = await createDraftCohortExamSession(
    {
      repository: sessions,
      now: () => new Date("2026-07-05T09:10:00.000Z"),
      newId: () => "cohort-session-1",
    },
    {
      customerId: "customer-helios",
      examId: "exam-1",
      name: "Morning Cohort",
      admissionStartsAt: new Date("2026-07-05T08:30:00.000Z"),
      admissionEndsAt: new Date("2026-07-05T12:00:00.000Z"),
    },
  );
  await markCohortExamSessionPublished(
    { repository: sessions, now: () => new Date("2026-07-05T09:15:00.000Z") },
    {
      session: { ...draft, status: "publishing", updatedAt: new Date("2026-07-05T09:14:00.000Z") },
      trainingId: "EXcohort-1",
      experienceId: "EXcohort-1",
      teamId: "TM-team-1",
    },
  );
  return sessions;
}

describe("joinCohortExamSessionRuntime", () => {
  it("creates an ExamAttempt attached to the published Cohort Exam Session and reuses the shared training", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory(),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-join-1",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 201,
      body: {
        attempt: {
          id: "attempt-1",
          examId: "exam-1",
          cohortSessionId: "cohort-session-1",
          scheduledFor: "2026-07-05T10:00:00.000Z",
          status: "ready",
        },
        correlationId: "corr-cohort-join-1",
      },
    });
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      cohortSessionId: "cohort-session-1",
      scheduledFor: new Date("2026-07-05T10:00:00.000Z"),
      status: "ready",
    });
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      trainingId: "EXcohort-1",
      experienceId: "EXcohort-1",
      participantEmail: "candidate@helioscx.demo",
    });
    await expect(
      diagnosticsRepository.query({ examAttemptId: "attempt-1", correlationId: "corr-cohort-join-1" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cohort_exam_session.join",
          outcome: "success",
          examId: "exam-1",
          examAttemptId: "attempt-1",
          externalIds: expect.objectContaining({
            cohortSessionId: "cohort-session-1",
            trainingId: "EXcohort-1",
            experienceId: "EXcohort-1",
          }),
        }),
      ]),
    );
  });

  it("writes explicit Certalis participant correlation to CloudShare, persists the returned participant ID, and records it in diagnostics", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([]),
    );
    const requestV4Detailed = vi.fn(
      async (spec: {
        method: string;
        path: string;
        body?: unknown;
        schema: { parse(value: unknown): unknown };
      }) => {
        if (spec.path === "/trainings/EXcohort-1") {
          const raw = {
            id: "EXcohort-1",
            status: "notStarted",
            start: "2026-07-05T08:30:00",
            timeZone: "UTC",
          };
          return {
            data: spec.schema.parse(raw),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.get",
            request: { method: spec.method, path: spec.path },
            response: { status: 200, body: raw },
          };
        }
        if (spec.path === "/trainings/EXcohort-1/students") {
          return {
            data: spec.schema.parse([
              {
                id: "student-1",
                email: "candidate@helioscx.demo",
              },
            ]),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.participant",
            request: {
              method: spec.method,
              path: spec.path,
              body: spec.body,
            },
            response: {
              status: 200,
              body: [
                {
                  id: "student-1",
                  email: "candidate@helioscx.demo",
                },
              ],
            },
          };
        }
        if (spec.method === "GET" && spec.path === "/trainings/EXcohort-1/users/properties") {
          return {
            data: spec.schema.parse([]),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.user_properties",
            request: { method: spec.method, path: spec.path },
            response: { status: 200, body: [] },
          };
        }
        if (spec.method === "POST" && spec.path === "/trainings/EXcohort-1/users/properties") {
          const raw = {
            id: (spec.body as { Name?: string }).Name,
            name: (spec.body as { Name?: string }).Name,
          };
          return {
            data: spec.schema.parse(raw),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.user_properties",
            request: { method: spec.method, path: spec.path, body: spec.body },
            response: { status: 201, body: raw },
          };
        }
        if (spec.path === "/trainings/EXcohort-1/sponsored-link") {
          const raw = {
            loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/cohort",
          };
          return {
            data: spec.schema.parse(raw),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.sponsored_link",
            request: {
              method: spec.method,
              path: spec.path,
              body: spec.body,
            },
            response: { status: 200, body: raw },
          };
        }
        throw new Error(`unexpected path ${spec.path}`);
      },
    );

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV3: requestV3 as never,
          requestV4Detailed: requestV4Detailed as never,
        }),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-join-1",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(201);
    const studentAddCall = requestV4Detailed.mock.calls.find(
      (call) => call[0].method === "POST" && call[0].path === "/trainings/EXcohort-1/students",
    );
    expect(studentAddCall?.[0]?.body).toEqual([
      {
        email: "candidate@helioscx.demo",
        firstName: "Asha",
        lastName: "Patel",
        customProperties: [
          { Name: "certalisExamAttemptId", Value: "attempt-1" },
          { Name: "certalisCandidateId", Value: "candidate-1" },
        ],
      },
    ]);
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      trainingId: "EXcohort-1",
      experienceId: "EXcohort-1",
      participantEmail: "candidate@helioscx.demo",
      participantId: "student-1",
    });
    await expect(
      diagnosticsRepository.query({
        examAttemptId: "attempt-1",
        correlationId: "corr-cohort-join-1",
        operation: "cloudshare.add_participant",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        externalIds: expect.objectContaining({
          cohortSessionId: "cohort-session-1",
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          participantId: "student-1",
        }),
      }),
    ]);
    expect(requestV3).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/class/actions/customfields" }));
    const ensureCallOrders = requestV4Detailed.mock.calls.flatMap((call, index) =>
      call[0].path === "/trainings/EXcohort-1/users/properties"
        ? [requestV4Detailed.mock.invocationCallOrder[index]]
        : [],
    );
    const studentAddOrder =
      requestV4Detailed.mock.invocationCallOrder[
        requestV4Detailed.mock.calls.findIndex(
          (call) => call[0].method === "POST" && call[0].path === "/trainings/EXcohort-1/students",
        )
      ];
    expect(ensureCallOrders).toHaveLength(3);
    expect(ensureCallOrders.every((order) => order < studentAddOrder)).toBe(true);
  });

  it("blocks candidate join when the Cohort Exam Session admission has been closed", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    await sessions.save({
      ...(await sessions.findById("cohort-session-1"))!,
      status: "closed",
      updatedAt: new Date("2026-07-05T09:30:00.000Z"),
    });
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory(),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-cohort-join-closed",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 404,
      body: { error: "Available Cohort Exam Session not found." },
    });
    await expect(attempts.listByCandidate("candidate-1")).resolves.toEqual([]);
    await expect(
      diagnosticsRepository.query({
        customerId: "customer-helios",
        operation: "cohort_exam_session.join",
        correlationId: "corr-cohort-join-closed",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "failure",
        message: "Available Cohort Exam Session not found.",
        details: expect.objectContaining({ reason: "available_session_not_found" }),
      }),
    ]);
  });

  it("blocks same-session retakes even after a prior attempt completed", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    await attempts.save({
      id: "attempt-old",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      cohortSessionId: "cohort-session-1",
      status: "completed",
      scheduledFor: new Date("2026-07-05T09:00:00.000Z"),
      createdAt: new Date("2026-07-05T09:00:00.000Z"),
    });

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory(),
        diagnostics: createDiagnosticRecorder({ repository: createInMemoryDiagnosticLogRepository() }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error: "This Cohort Exam Session does not allow another attempt for your account.",
        code: "cohort_session_retake_blocked",
      },
    });
  });

  it("records supportable diagnostics when training user-property verification fails before participant add", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const eventLog = createInMemoryEventLogRepository();
    const requestV3 = vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
      spec.schema.parse([]),
    );
    const requestV4Detailed = vi.fn(
      async (spec: {
        method: string;
        path: string;
        body?: unknown;
        schema: { parse(value: unknown): unknown };
      }) => {
        if (spec.path === "/trainings/EXcohort-1") {
          const raw = {
            id: "EXcohort-1",
            status: "notStarted",
            start: "2026-07-05T08:30:00",
            timeZone: "UTC",
          };
          return {
            data: spec.schema.parse(raw),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.get",
            request: { method: spec.method, path: spec.path },
            response: { status: 200, body: raw },
          };
        }
        if (spec.method === "GET" && spec.path === "/trainings/EXcohort-1/users/properties") {
          throw new CloudShareResponseError("CloudShare response did not match the expected schema", {
            method: "GET",
            path: "/v4/trainings/EXcohort-1/users/properties",
            integrationSurface: "cloudshare.v4.training.user_properties",
            status: 500,
            responseBody: { error: "tenant unavailable" },
            issues: ["Unable to read training user properties."],
          });
        }
        throw new Error(`unexpected path ${spec.path}`);
      },
    );

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV3: requestV3 as never,
          requestV4Detailed: requestV4Detailed as never,
        }),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-user-properties-fail",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 502,
      body: {
        error: "CloudShare provisioning failed for the shared cohort Exam Session.",
        correlationId: "corr-user-properties-fail",
      },
    });
    expect(requestV3).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/class/actions/customfields" }));
    expect(requestV4Detailed).toHaveBeenCalledTimes(2);
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
    await expect(
      diagnosticsRepository.query({
        examAttemptId: "attempt-1",
        correlationId: "corr-user-properties-fail",
        operation: "cloudshare.ensure_user_properties",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "failure",
        request: {
          method: "GET",
          path: "/v4/trainings/EXcohort-1/users/properties",
        },
        response: {
          status: 500,
          body: { error: "tenant unavailable" },
        },
        details: expect.objectContaining({
          attemptedOperation: "ensure_user_properties",
          integrationSurface: "cloudshare.v4.training.user_properties",
          responseStatus: 500,
        }),
      }),
    ]);
    await expect(eventLog.listAll()).resolves.toEqual([
      expect.objectContaining({
        eventId: "corr-user-properties-fail",
        payload: expect.objectContaining({
          attemptedOperation: "ensure_user_properties",
          responseStatus: 500,
        }),
      }),
    ]);
  });

  it("allows join when the saved Exam snapshot still matches the current CloudShare Blueprint default Snapshot", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const source = makeAuthoringSource();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: {
          forConnection: vi.fn(() => ({
            ...source,
            requestV3: vi.fn(async (spec: { schema: { parse(value: unknown): unknown } }) =>
              spec.schema.parse([]),
            ) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>["requestV3"],
            requestV3Text: vi.fn(),
            requestV4: vi.fn(),
            requestV4Detailed: makeCloudShareFactory().forConnection({} as never).requestV4Detailed,
          })),
        },
        diagnostics: createDiagnosticRecorder({ repository: createInMemoryDiagnosticLogRepository() }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-snapshot-ok",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(201);
    expect(source.getBlueprintDetail).toHaveBeenCalledWith("project-1", "bp-1");
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toMatchObject({
      trainingId: "EXcohort-1",
    });
  });

  it("blocks join before participant add or sponsored-link creation when the CloudShare Blueprint default Snapshot has drifted", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockResolvedValue({
        id: "bp-1",
        name: "Helios Exam Blueprint",
        description: "",
        defaultSnapshotId: "snap-2",
        snapshots: [
          { id: "snap-1", name: "Default Snapshot", isDefault: false, regionIds: ["region-1"] },
          { id: "snap-2", name: "New Default Snapshot", isDefault: true, regionIds: ["region-1"] },
        ],
      }),
    });
    const requestV4Detailed = vi.fn();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: {
          forConnection: vi.fn(() => ({
            ...source,
            requestV3: vi.fn(),
            requestV3Text: vi.fn(),
            requestV4: vi.fn(),
            requestV4Detailed,
          })),
        },
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-snapshot-drift",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 423,
      body: {
        error:
          "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.",
        correlationId: "corr-cohort-snapshot-drift",
      },
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-cohort-snapshot-drift" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cohort_exam_session.join",
          outcome: "failure",
          examId: "exam-1",
          examAttemptId: "attempt-1",
          candidateEmail: "candidate@helioscx.demo",
          details: expect.objectContaining({
            failureMode: "snapshot_drift",
            projectId: "project-1",
            blueprintId: "bp-1",
            savedSnapshotId: "snap-1",
            currentDefaultSnapshotId: "snap-2",
            cohortSessionId: "cohort-session-1",
          }),
        }),
      ]),
    );
  });

  it("blocks join with candidate-safe unavailable copy and no usable attempt when the CloudShare default Snapshot lookup fails", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const source = makeAuthoringSource({
      getBlueprintDetail: vi.fn().mockRejectedValue(
        new CloudShareTransportError("CloudShare was unreachable", {
          method: "GET",
          path: "/api/v3/projects/project-1/blueprints/bp-1",
          integrationSurface: "cloudshare.v3.projects.blueprint_detail",
        }),
      ),
    });
    const requestV4Detailed = vi.fn();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: {
          forConnection: vi.fn(() => ({
            ...source,
            requestV3: vi.fn(),
            requestV3Text: vi.fn(),
            requestV4: vi.fn(),
            requestV4Detailed,
          })),
        },
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-snapshot-lookup-fail",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 423,
      body: {
        error:
          "Exam entry is temporarily unavailable because the lab configuration changed. Contact your administrator.",
        correlationId: "corr-cohort-snapshot-lookup-fail",
      },
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-cohort-snapshot-lookup-fail" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cohort_exam_session.join",
          outcome: "failure",
          examAttemptId: "attempt-1",
          request: expect.objectContaining({
            method: "GET",
            path: "/api/v3/projects/project-1/blueprints/bp-1",
          }),
          details: expect.objectContaining({
            failureMode: "snapshot_lookup_failed",
            currentDefaultSnapshotId: null,
            transport: "CloudShare was unreachable",
            cohortSessionId: "cohort-session-1",
          }),
        }),
      ]),
    );
  });

  it("blocks join when CloudShare reports the shared training starts in the future", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const requestV4Detailed = vi.fn(
      async (spec: {
        method: string;
        path: string;
        body?: unknown;
        schema: { parse(value: unknown): unknown };
      }) => {
        if (spec.path === "/trainings/EXcohort-1") {
          const raw = {
            id: "EXcohort-1",
            status: "notStarted",
            start: "2026-07-12T11:38:00",
          };
          return {
            data: spec.schema.parse(raw),
            host: "api.accelerate.cloudshare.com",
            integrationSurface: "cloudshare.v4.training.get",
            request: { method: spec.method, path: spec.path },
            response: { status: 200, body: raw },
          };
        }
        throw new Error(`unexpected path ${spec.path}`);
      },
    );

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({ requestV4Detailed: requestV4Detailed as never }),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-not-started").mockReturnValueOnce("launch-ignored"),
        newCorrelationId: () => "corr-cloudshare-not-started",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error: "This Cohort Exam Session is not open in CloudShare yet.",
        code: "cloudshare_training_not_started",
        cloudShareStartsAt: "2026-07-12T11:38:00.000Z",
        correlationId: "corr-cloudshare-not-started",
      },
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
    await expect(attempts.findById("attempt-not-started")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-not-started")).resolves.toBeNull();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-cloudshare-not-started" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.read_training",
          outcome: "success",
          examId: "exam-1",
          request: expect.objectContaining({
            method: "GET",
            path: "/trainings/EXcohort-1",
          }),
          response: expect.objectContaining({
            status: 200,
            body: expect.objectContaining({
              id: "EXcohort-1",
              start: "2026-07-12T11:38:00",
            }),
          }),
          details: expect.objectContaining({
            integrationSurface: "cloudshare.v4.training.get",
            cloudShareStartsAt: "2026-07-12T11:38:00.000Z",
            cloudShareRawStartsAt: "2026-07-12T11:38:00",
          }),
        }),
        expect.objectContaining({
          operation: "cohort_exam_session.join",
          outcome: "failure",
          examId: "exam-1",
          externalIds: expect.objectContaining({
            cohortSessionId: "cohort-session-1",
            trainingId: "EXcohort-1",
            experienceId: "EXcohort-1",
          }),
          details: expect.objectContaining({
            reason: "cloudshare_training_not_started",
            cloudShareStatus: "notStarted",
            cloudShareStartsAt: "2026-07-12T11:38:00.000Z",
            cloudShareRawStartsAt: "2026-07-12T11:38:00",
            localAdmissionStartsAt: "2026-07-05T08:30:00.000Z",
          }),
        }),
      ]),
    );
  });

  it("blocks concurrent same-session joins when persistence detects the duplicate", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts: ExamAttemptRepository = {
      save: vi.fn(async (attempt) => {
        throw new DuplicateCohortExamAttemptError(
          attempt.candidateId,
          attempt.cohortSessionId ?? "missing",
        );
      }),
      findById: vi.fn(),
      listByCandidate: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    };
    const cloudshare = makeCloudShareFactory();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare,
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: () => "attempt-race-loser",
        newCorrelationId: () => "corr-cohort-race",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error: "This Cohort Exam Session does not allow another attempt for your account.",
        code: "cohort_session_retake_blocked",
      },
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-cohort-race" }),
    ).resolves.toEqual([
      expect.objectContaining({
        operation: "cohort_exam_session.join",
        outcome: "failure",
        examId: "exam-1",
        examAttemptId: null,
        externalIds: expect.objectContaining({
          cohortSessionId: "cohort-session-1",
          trainingId: "EXcohort-1",
        }),
        details: expect.objectContaining({
          reason: "cohort_session_retake_blocked",
        }),
      }),
    ]);
  });

  it("blocks concurrent same-Exam overlaps when persistence detects another active attempt", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts: ExamAttemptRepository = {
      save: vi.fn(),
      saveWithSameExamAvailabilityGuard: vi.fn(async (attempt) => {
        throw new SameExamAttemptAvailabilityConflictError(
          attempt.candidateId,
          attempt.examId,
          "attempt-other-mode",
          new Date("2026-07-05T12:00:00.000Z"),
        );
      }),
      findById: vi.fn(),
      listByCandidate: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    };
    const cloudshare = makeCloudShareFactory();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare,
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: () => "attempt-race-overlap",
        newCorrelationId: () => "corr-cohort-overlap-race",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error:
          "Another attempt for this Exam is still active or available. You can schedule this Exam again after 2026-07-05T12:00:00.000Z.",
        code: "exam_attempt_overlap",
        nextAvailableAt: "2026-07-05T12:00:00.000Z",
      },
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-cohort-overlap-race" }),
    ).resolves.toEqual([
      expect.objectContaining({
        operation: "cohort_exam_session.join",
        outcome: "failure",
        examId: "exam-1",
        examAttemptId: null,
        details: expect.objectContaining({
          reason: "exam_attempt_overlap",
          conflictingAttemptId: "attempt-other-mode",
          nextAvailableAt: "2026-07-05T12:00:00.000Z",
        }),
      }),
    ]);
  });

  it("records supportable diagnostics when participant add fails and does not create a new ExamAttempt", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const eventLog = createInMemoryEventLogRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV4Detailed: vi.fn(async (spec: { path: string }) => {
            if (spec.path === "/trainings/EXcohort-1") {
              return {
                data: {
                  id: "EXcohort-1",
                  status: "notStarted",
                  start: "2026-07-05T08:30:00",
                  timeZone: "UTC",
                },
                host: "api.accelerate.cloudshare.com",
                integrationSurface: "cloudshare.v4.training.get",
                request: { method: "GET", path: spec.path },
                response: {
                  status: 200,
                  body: {
                    id: "EXcohort-1",
                    status: "notStarted",
                    start: "2026-07-05T08:30:00",
                    timeZone: "UTC",
                  },
                },
              };
            }
            if (spec.path === "/trainings/EXcohort-1/users/properties") {
              if ("method" in spec && spec.method === "POST") {
                return {
                  data: { id: "TF-created", name: "certalisCandidateId" },
                  host: "api.accelerate.cloudshare.com",
                  integrationSurface: "cloudshare.v4.training.user_properties",
                  request: { method: "POST", path: spec.path },
                  response: { status: 201, body: { id: "TF-created", name: "certalisCandidateId" } },
                };
              }
              return {
                data: [],
                host: "api.accelerate.cloudshare.com",
                integrationSurface: "cloudshare.v4.training.user_properties",
                request: { method: "GET", path: spec.path },
                response: { status: 200, body: [] },
              };
            }
            if (spec.path === "/trainings/EXcohort-1/students") {
              throw new CloudShareRequestError("forbidden", 403, {
                method: "POST",
                path: "/v4/trainings/EXcohort-1/students",
                integrationSurface: "cloudshare.v4.training.participant",
                requestBody: {
                  email: "candidate@helioscx.demo",
                  firstName: "Asha",
                  lastName: "Patel",
                },
                responseBody: { error: "forbidden" },
              });
            }
            throw new Error(`unexpected path ${spec.path}`);
          }) as never,
        }),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-join-fail",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 502,
      body: {
        error: "CloudShare provisioning failed for the shared cohort Exam Session.",
        correlationId: "corr-cohort-join-fail",
      },
    });
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
    await expect(eventLog.listAll()).resolves.toEqual([
      expect.objectContaining({
        eventId: "corr-cohort-join-fail",
        type: "cloudshare.cohort_exam_session_join.failed",
        payload: expect.objectContaining({
          examAttemptId: "attempt-1",
          attemptedOperation: "add_participant",
          integrationSurface: "cloudshare.v4.training.participant",
          responseStatus: 403,
        }),
      }),
    ]);
    await expect(
      diagnosticsRepository.query({ examAttemptId: "attempt-1", correlationId: "corr-cohort-join-fail" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.add_participant",
          outcome: "failure",
          externalIds: expect.objectContaining({
            cohortSessionId: "cohort-session-1",
            trainingId: "EXcohort-1",
          }),
          response: expect.objectContaining({
            status: 403,
            body: { error: "forbidden" },
          }),
        }),
      ]),
    );
  });

  it("records supportable diagnostics when sponsored-link creation fails after participant add", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const launches = createInMemoryLabLaunchRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV4Detailed: vi.fn(async (spec: { method: string; path: string; schema: { parse(value: unknown): unknown } }) => {
            if (spec.path === "/trainings/EXcohort-1") {
              const raw = {
                id: "EXcohort-1",
                status: "notStarted",
                start: "2026-07-05T08:30:00",
                timeZone: "UTC",
              };
              return {
                data: spec.schema.parse(raw),
                host: "api.accelerate.cloudshare.com",
                integrationSurface: "cloudshare.v4.training.get",
                request: { method: spec.method, path: spec.path },
                response: { status: 200, body: raw },
              };
            }
            if (spec.path === "/trainings/EXcohort-1/users/properties") {
              const raw =
                spec.method === "POST"
                  ? { id: "TF-created", name: "certalisCandidateId" }
                  : [];
              return {
                data: spec.schema.parse(raw),
                host: "api.accelerate.cloudshare.com",
                integrationSurface: "cloudshare.v4.training.user_properties",
                request: { method: spec.method, path: spec.path },
                response: { status: spec.method === "POST" ? 201 : 200, body: raw },
              };
            }
            if (spec.path === "/trainings/EXcohort-1/students") {
              return {
                data: spec.schema.parse([{}]),
                host: "api.accelerate.cloudshare.com",
                integrationSurface: "cloudshare.v4.training.participant",
                request: { method: spec.method, path: spec.path },
                response: { status: 200, body: [{}] },
              };
            }
            if (spec.path === "/trainings/EXcohort-1/sponsored-link") {
              throw new CloudShareRequestError("forbidden", 403, {
                method: "POST",
                path: "/v4/trainings/EXcohort-1/sponsored-link",
                integrationSurface: "cloudshare.v4.training.sponsored_link",
                responseBody: { error: "forbidden" },
              });
            }
            throw new Error(`unexpected path ${spec.path}`);
          }) as never,
        }),
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-1").mockReturnValueOnce("launch-1"),
        newCorrelationId: () => "corr-cohort-link-fail",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 502,
      body: {
        error: "CloudShare provisioning failed for the shared cohort Exam Session.",
        correlationId: "corr-cohort-link-fail",
      },
    });
    await expect(attempts.findById("attempt-1")).resolves.toBeNull();
    await expect(launches.findByExamAttemptId("attempt-1")).resolves.toBeNull();
    await expect(
      diagnosticsRepository.query({ examAttemptId: "attempt-1", correlationId: "corr-cohort-link-fail" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "cloudshare.create_sponsored_link",
          outcome: "failure",
          externalIds: expect.objectContaining({
            cohortSessionId: "cohort-session-1",
            trainingId: "EXcohort-1",
          }),
          response: expect.objectContaining({
            status: 403,
            body: { error: "forbidden" },
          }),
        }),
      ]),
    );

    const retry = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches,
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory(),
        diagnostics: createDiagnosticRecorder({ repository: createInMemoryDiagnosticLogRepository() }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:01:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-retry").mockReturnValueOnce("launch-retry"),
        newCorrelationId: () => "corr-cohort-link-retry",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );
    expect(retry).toMatchObject({
      status: 201,
      body: {
        attempt: {
          id: "attempt-retry",
          cohortSessionId: "cohort-session-1",
          status: "ready",
        },
      },
    });
    await expect(launches.findByExamAttemptId("attempt-retry")).resolves.toMatchObject({
      loginUrl: "https://use.cloudshare.com/Ent/Course.mvc/ClassSponsoredLink/cohort",
    });
  });

  it("blocks overlapping active attempts for the same Exam before touching CloudShare", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    await attempts.save({
      id: "attempt-existing",
      customerId: "customer-helios",
      candidateId: "candidate-1",
      examId: "exam-1",
      status: "ready",
      scheduledFor: new Date("2026-07-05T09:45:00.000Z"),
      createdAt: new Date("2026-07-05T09:45:00.000Z"),
    });
    const cloudshare = makeCloudShareFactory();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare,
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-overlap-1",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: {
        error:
          "Another attempt for this Exam is still active or available. You can schedule this Exam again after 2026-07-05T11:45:00.000Z.",
        code: "exam_attempt_overlap",
        nextAvailableAt: "2026-07-05T11:45:00.000Z",
      },
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-overlap-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        operation: "cohort_exam_session.join",
        outcome: "failure",
        examId: "exam-1",
        examAttemptId: null,
        externalIds: expect.objectContaining({
          cohortSessionId: "cohort-session-1",
          trainingId: "EXcohort-1",
        }),
        details: expect.objectContaining({
          reason: "exam_attempt_overlap",
          conflictingAttemptId: "attempt-existing",
        }),
      }),
    ]);
  });

  it("returns candidate-safe copy when the Cohort Snapshot lookup is rate limited", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const attempts = createInMemoryExamAttemptRepository();
    const cloudshare = makeCloudShareFactory({
      getBlueprintDetail: vi.fn().mockRejectedValue(
        new CloudShareRateLimitError("too many requests", 429, "rate_limit", {
          surface: "cloudshare.v3.projects.blueprint_detail",
          method: "GET",
          path: "/projects/project-1/blueprints/bp-1",
          responseHeaders: {},
          responseBody: { code: "0x42901" },
        }),
      ),
    });

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts,
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(),
        cloudshare,
        diagnostics: createDiagnosticRecorder({ repository: createInMemoryDiagnosticLogRepository() }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newId: vi.fn().mockReturnValueOnce("attempt-rate-limited"),
        newCorrelationId: () => "corr-cohort-snapshot-rate-limit",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 429,
      body: {
        error: "Something is not working right now. Contact your instructor before trying again.",
        correlationId: "corr-cohort-snapshot-rate-limit",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("support@cloudshare.com");
    await expect(attempts.findById("attempt-rate-limited")).resolves.toBeNull();
  });

  it("records a diagnostic when CloudShare is not connected before touching CloudShare", async () => {
    const exams = await makeExamRepository();
    const sessions = await makePublishedSession();
    const cloudshare = makeCloudShareFactory();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();

    const response = await joinCohortExamSessionRuntime(
      {
        exams,
        sessions,
        attempts: createInMemoryExamAttemptRepository(),
        launches: createInMemoryLabLaunchRepository(),
        audit: createInMemoryAuditRepository(),
        eventLog: createInMemoryEventLogRepository(),
        connections: makeConnectionRepository(null),
        cloudshare,
        diagnostics: createDiagnosticRecorder({ repository: diagnosticsRepository }),
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-missing-connection",
      },
      {
        customerId: "customer-helios",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        candidateFirstName: "Asha",
        candidateLastName: "Patel",
        examId: "exam-1",
        cohortSessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 409,
      body: { error: "CloudShare is not connected for this customer." },
    });
    expect(cloudshare.forConnection).not.toHaveBeenCalled();
    await expect(
      diagnosticsRepository.query({ correlationId: "corr-missing-connection" }),
    ).resolves.toEqual([
      expect.objectContaining({
        operation: "cohort_exam_session.join",
        outcome: "failure",
        candidateEmail: "candidate@helioscx.demo",
        externalIds: expect.objectContaining({
          cohortSessionId: "cohort-session-1",
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
        }),
        details: expect.objectContaining({
          reason: "cloudshare_connection_missing",
        }),
      }),
    ]);
  });
});
