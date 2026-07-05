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
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import { CloudShareRequestError } from "@/integrations/cloudshare";
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
  overrides: Partial<ReturnType<CloudShareClientFactory["forConnection"]>> = {},
): CloudShareClientFactory {
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
          spec.path === "/trainings/EXcohort-1/students"
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
            : "cloudshare.v4.training.sponsored_link",
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
      requestV3: vi.fn(),
      requestV3Text: vi.fn(),
      requestV4: vi.fn(),
      requestV4Detailed,
      ...overrides,
    })),
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
    await expect(attempts.findById("attempt-1")).resolves.toMatchObject({
      cohortSessionId: "cohort-session-1",
      scheduledFor: new Date("2026-07-05T10:00:00.000Z"),
      status: "scheduled",
    });
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
