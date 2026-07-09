import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, publishExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import { createDraftCohortExamSession, markCohortExamSessionPublished } from "@/domain/cohort-exam-session";
import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { CloudShareRateLimitError, CloudShareRequestError, CloudShareResponseError } from "@/integrations/cloudshare";
import type { Logger } from "@/observability/logger";
import { createInMemoryCohortExamSessionRepository } from "@/persistence/cohort-exam-session-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import type { AdminCohortExamSessionAttemptRepository } from "./admin-cohort-exam-session-detail";
import {
  handleCloseCohortExamSessionAdmission,
  handleRetireCohortExamSession,
} from "./admin-cohort-exam-session-lifecycle";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeExamInput(overrides: Partial<CreateDraftExamInput> = {}): CreateDraftExamInput {
  return {
    customerId: "customer-1",
    title: "Helios CloudShare Fundamentals",
    description: "Hands-on exam",
    timeLimitMinutes: 240,
    storageLeaseMinutes: 2880,
    openPeriodMinutes: 720,
    scoreRetrievalEnabled: true,
    deliveryAvailability: "both",
    projectId: "project-1",
    projectName: "Helios CX Project",
    blueprintId: "bp-1",
    blueprintName: "Helios Exam Blueprint",
    snapshotId: "snap-1",
    snapshotName: "Default Snapshot",
    allowedRegions: [
      { id: "region-1", name: "EU West" },
      { id: "region-2", name: "US East" },
    ],
    policyId: "policy-1",
    policyName: "Standard Exam Policy",
    instructorId: "instructor-1",
    instructorName: "Helios Service Account",
    ...overrides,
  };
}

async function seedPublishedSession() {
  const exams = createInMemoryExamCatalogRepository();
  const sessions = createInMemoryCohortExamSessionRepository();
  await createDraftExam(
    {
      repository: exams,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      newId: () => "exam-1",
    },
    makeExamInput(),
  );
  await publishExam(
    { repository: exams, now: () => new Date("2026-07-04T10:05:00.000Z") },
    { customerId: "customer-1", examId: "exam-1" },
  );
  const draft = await createDraftCohortExamSession(
    {
      repository: sessions,
      now: () => new Date("2026-07-04T11:00:00.000Z"),
      newId: () => "cohort-session-1",
    },
    {
      customerId: "customer-1",
      examId: "exam-1",
      name: "Morning Cohort",
      admissionStartsAt: new Date("2026-07-05T08:30:00.000Z"),
      admissionEndsAt: new Date("2026-07-05T12:00:00.000Z"),
      capacity: 25,
    },
  );
  await markCohortExamSessionPublished(
    { repository: sessions, now: () => new Date("2026-07-04T12:00:00.000Z") },
    {
      session: { ...draft, status: "publishing", updatedAt: new Date("2026-07-04T11:59:00.000Z") },
      trainingId: "EXcohort-1",
      experienceId: "EXcohort-1",
      teamId: "TM-team-1",
    },
  );

  return { exams, sessions };
}

describe("admin cohort exam session lifecycle runtime", () => {
  const actor = {
    type: "admin",
    id: "admin-1",
    email: "admin@helioscx.demo",
  } as const;

  it("closes admission for a published Cohort Exam Session without deleting it", async () => {
    const { exams, sessions } = await seedPublishedSession();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const audit = { write: vi.fn().mockResolvedValue(undefined) };

    const response = await handleCloseCohortExamSessionAdmission(
      {
        exams,
        sessions,
        diagnostics,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newAuditId: () => "audit-close-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      session: {
        session: {
          id: "cohort-session-1",
          status: "closed",
        },
      },
    });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "closed",
      cloudShareTrainingId: "EXcohort-1",
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.close_admission",
    });
    expect(entry).toMatchObject({
      actor,
      outcome: "success",
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      details: {
        changedFields: ["status"],
      },
      externalIds: {
        cohortSessionId: "cohort-session-1",
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
      },
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-close-1",
        action: "cohort_exam_session.admission_closed",
        subjectId: "cohort-session-1",
        examId: "exam-1",
      }),
    );
  });

  it("warns and requires confirmation before retiring a session with active CloudShare participants", async () => {
    const { exams, sessions } = await seedPublishedSession();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([
        {
          id: "attempt-1",
          customerId: "customer-1",
          candidateId: "candidate-1",
          candidateEmail: "candidate@helioscx.demo",
          candidateFirstName: "Asha",
          candidateLastName: "Patel",
          examId: "exam-1",
          examTitle: "Helios CloudShare Fundamentals",
          status: "in_progress",
          scheduledFor: new Date("2026-07-05T09:00:00.000Z"),
          createdAt: new Date("2026-07-05T09:00:00.000Z"),
          trainingId: "EXcohort-1",
          experienceId: "EXcohort-1",
          environmentExternalId: "ENVS-1",
          environmentId: "ENVS-1",
          participantId: "student-1",
        },
      ]),
    };
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse([
          {
            email: "candidate@helioscx.demo",
            envId: "ENVS-1",
            envStatus: "Running",
            participationStatus: "inProgress",
          },
        ]),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.participant",
        request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
        response: { status: 200, body: [] },
      }))
      .mockImplementationOnce(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse([
          {
            email: "candidate@helioscx.demo",
            envId: "ENVS-1",
            envStatus: "Running",
            participationStatus: "inProgress",
          },
        ]),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.participant",
        request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
        response: { status: 200, body: [] },
      }))
      .mockImplementationOnce(async (spec: { method: string; path: string; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({
          id: "EXcohort-1",
          Name: "Retirement Smoke Cohort",
          Start: "2026-07-05T09:00:00",
          End: "2026-07-05T11:00:00",
          Type: "selfPaced",
          TeamId: "team-1",
          PolicyId: "policy-1",
          TimeZone: "UTC",
          ProjectId: "project-1",
          Passphrase: "certalis-cohort",
          MaxStudents: 20,
          BlueprintIds: ["blueprint-1"],
          MainInstructor: { Email: "instructor@example.com" },
          UsersEarlyAccess: { GrantEarlyAccess: 2 },
          CloudshareRegionIds: ["region-1"],
          RegistrationType: "registeredStudentsOnly",
        }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.detail",
        request: { method: spec.method, path: "/v4" + spec.path },
        response: { status: 200, body: { id: "EXcohort-1" } },
      }))
      .mockImplementationOnce(async (spec: {
        method: string;
        path: string;
        body: Record<string, unknown>;
        schema: { parse(value: unknown): unknown };
      }) => ({
        data: spec.schema.parse({ id: "EXcohort-1", end: spec.body.End }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.update",
        request: { method: spec.method, path: "/v4" + spec.path, body: spec.body },
        response: { status: 200, body: { id: "EXcohort-1", end: spec.body.End } },
      }));
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const warning = await handleRetireCohortExamSession(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-retire-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
        body: {},
      },
    );

    expect(warning.status).toBe(409);
    expect(warning.body).toMatchObject({
      error: "Active participants may be interrupted by retiring this Cohort Exam Session.",
      code: "confirmation_required",
      warning: {
        activeParticipantCount: 1,
        nonTerminalEnvironmentCount: 1,
      },
    });

    const confirmed = await handleRetireCohortExamSession(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-retire-2",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
        body: { confirmInterrupt: true },
      },
    );

    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      session: {
        session: {
          id: "cohort-session-1",
          status: "retired",
        },
      },
      warning: {
        activeParticipantCount: 1,
        nonTerminalEnvironmentCount: 1,
      },
    });
    expect(requestV4Detailed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "PUT",
        path: "/trainings/EXcohort-1",
        body: expect.objectContaining({
          End: "2026-07-05T10:00:00.000Z",
        }),
      }),
    );
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "retired",
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.retire",
    });
    expect(entry).toMatchObject({
      actor,
      outcome: "success",
      correlationId: "corr-retire-2",
      externalIds: {
        cohortSessionId: "cohort-session-1",
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
      },
      details: {
        activeParticipantCount: 1,
        nonTerminalEnvironmentCount: 1,
        confirmationRequired: true,
        integrationSurface: "cloudshare.v4.training.update",
      },
      request: {
        method: "PUT",
        path: "/v4/trainings/EXcohort-1",
      },
      response: {
        status: 200,
      },
    });
  });

  it("records a failed retire diagnostic when CloudShare rejects the Experience end update", async () => {
    const { exams, sessions } = await seedPublishedSession();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse([]),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.participant",
        request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
        response: { status: 200, body: [] },
      }))
      .mockRejectedValueOnce(
        new CloudShareRequestError("forbidden", 403, {
          method: "PUT",
          path: "/v4/trainings/EXcohort-1",
          integrationSurface: "cloudshare.v4.training.update",
          responseBody: { message: "Forbidden" },
        }),
      );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleRetireCohortExamSession(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-retire-failure-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
        body: { confirmInterrupt: true },
      },
    );

    expect(response).toEqual({
      status: 502,
      body: {
        error: "CloudShare could not retire this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
        correlationId: "corr-retire-failure-1",
      },
    });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "published",
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.retire",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-retire-failure-1",
      details: {
        integrationSurface: "cloudshare.v4.training.update",
        failureMode: "http_status",
      },
      response: {
        status: 403,
        body: { message: "Forbidden" },
      },
    });
  });

  it("returns 429 with rate-limit diagnostics when CloudShare throttles Cohort Exam Session retirement", async () => {
    const { exams, sessions } = await seedPublishedSession();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse([]),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.participant",
        request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
        response: { status: 200, body: [] },
      }))
      .mockRejectedValueOnce(
        new CloudShareRateLimitError("too many requests", 429, "rate_limit", {
          method: "PUT",
          path: "/v4/trainings/EXcohort-1",
          integrationSurface: "cloudshare.v4.training.update",
          responseHeaders: { "retry-after": "30" },
        }),
      );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleRetireCohortExamSession(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-retire-rate-limit",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
        body: { confirmInterrupt: true },
      },
    );

    expect(response).toEqual({
      status: 429,
      body: {
        error: "CloudShare is returning a 429 error for the current request. This is likely CloudShare rate limiting or abuse protection blocking the request. Check whether this public IP needs CloudShare allow-list or abuse-list review before retrying by contacting support@cloudshare.com.",
        correlationId: "corr-retire-rate-limit",
      },
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.retire",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-retire-rate-limit",
      details: {
        integrationSurface: "cloudshare.v4.training.update",
        failureMode: "rate_limit",
        responseStatus: 429,
      },
      response: {
        status: 429,
        headers: { "retry-after": "30" },
      },
    });
  });

  it("does not retire the portal session when CloudShare never confirms the new end time", async () => {
    const { exams, sessions } = await seedPublishedSession();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const attempts: AdminCohortExamSessionAttemptRepository = {
      listBySessionId: vi.fn().mockResolvedValue([]),
    };
    const requestV4Detailed = vi
      .fn()
      .mockImplementationOnce(async (spec: { schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse([]),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training.participant",
        request: { method: "GET", path: "/v4/trainings/EXcohort-1/students" },
        response: { status: 200, body: [] },
      }))
      .mockRejectedValueOnce(
        new CloudShareResponseError("CloudShare did not confirm the Cohort Exam Session retirement end time.", {
          method: "PUT",
          path: "/v4/trainings/EXcohort-1",
          integrationSurface: "cloudshare.v4.training.update",
          requestBody: { End: "2026-07-05T10:00:00.000Z" },
          responseBody: {
            update: { id: "EXcohort-1" },
            readback: { id: "EXcohort-1", End: "2026-07-06T10:15:00.000Z" },
          },
          cause: "retire_training_end_unconfirmed",
        }),
      );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handleRetireCohortExamSession(
      {
        exams,
        sessions,
        attempts,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "api-key",
            webhookSecret: "whsec",
            webhookPathToken: "webhook-token",
            connectedAt: new Date("2026-07-01T00:00:00.000Z"),
            verifiedAt: new Date("2026-07-01T00:05:00.000Z"),
          })),
          save: vi.fn(),
          findByWebhookPathToken: vi.fn(),
          markVerified: vi.fn(),
        },
        cloudshare,
        diagnostics,
        logger: makeLogger(),
        now: () => new Date("2026-07-05T10:00:00.000Z"),
        newCorrelationId: () => "corr-retire-failure-2",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
        body: { confirmInterrupt: true },
      },
    );

    expect(response).toEqual({
      status: 502,
      body: {
        error: "CloudShare could not retire this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
        correlationId: "corr-retire-failure-2",
      },
    });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "published",
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.retire",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-retire-failure-2",
      request: {
        method: "PUT",
        path: "/v4/trainings/EXcohort-1",
        body: { End: "2026-07-05T10:00:00.000Z" },
      },
      response: {
        body: {
          update: { id: "EXcohort-1" },
          readback: { id: "EXcohort-1", End: "2026-07-06T10:15:00.000Z" },
        },
      },
      details: {
        integrationSurface: "cloudshare.v4.training.update",
        failureMode: "unexpected_response",
        cause: "retire_training_end_unconfirmed",
      },
    });
  });
});
