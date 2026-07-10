import { describe, expect, it, vi } from "vitest";
import { createDiagnosticRecorder } from "@/domain/diagnostic-log";
import { createDraftExam, type CreateDraftExamInput } from "@/domain/exam-catalog";
import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { CloudShareRequestError, CloudShareResponseError, CloudShareTransportError } from "@/integrations/cloudshare";
import { createInMemoryCohortExamSessionRepository } from "@/persistence/cohort-exam-session-repository";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import { createInMemoryExamCatalogRepository } from "@/persistence/exam-catalog-repository";
import type { Logger } from "@/observability/logger";
import {
  handleCreateDraftCohortExamSession,
  handleGetCohortExamSession,
  handleListCohortExamSessions,
  handlePublishCohortExamSession,
} from "./admin-cohort-exam-sessions";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function seedExam(
  exams: ReturnType<typeof createInMemoryExamCatalogRepository>,
  overrides: Partial<CreateDraftExamInput> = {},
) {
  await createDraftExam(
    {
      repository: exams,
      now: () => new Date("2026-07-04T10:00:00.000Z"),
      newId: () => "exam-1",
    },
    {
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
    },
  );
}

function parseSuccessfulPublishV3(
  spec: { path?: string; schema: { parse(value: unknown): unknown } },
  teamRows: Array<{ id: string; name: string }> = [{ id: "TM-team-1", name: "Helios Team" }],
) {
  if (spec.path === "/class/actions/customfields") {
    return spec.schema.parse([
      { id: "TF-attempt", name: "certalisExamAttemptId", type: 0, isRequired: false, regex: "", defaultValue: null, value: null },
      { id: "TF-cohort", name: "certalisCohortSessionId", type: 0, isRequired: false, regex: "", defaultValue: null, value: null },
      { id: "TF-candidate", name: "certalisCandidateId", type: 0, isRequired: false, regex: "", defaultValue: null, value: null },
    ]);
  }
  if (spec.path === "/projects/project-1/blueprints/bp-1") {
    return spec.schema.parse({
      id: "bp-1",
      name: "Helios Exam Blueprint",
      createFromVersions: [
        {
          id: "snap-1",
          name: "Default Snapshot",
          isDefault: true,
          Regions: ["region-1", "region-2"],
        },
      ],
    });
  }
  return spec.schema.parse({ rows: teamRows });
}

describe("admin Cohort Exam Session runtime", () => {
  const actor = {
    type: "admin",
    id: "admin-1",
    email: "admin@helioscx.demo",
  } as const;

  it("creates a draft Cohort Exam Session and returns inherited Exam CloudShare context", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    await seedExam(exams);

    const response = await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        diagnostics,
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
        newAuditId: () => "audit-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
          admissionEndsAt: "2026-07-31T17:00:00.000Z",
          capacity: 25,
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      session: {
        id: "cohort-session-1",
        name: "July Admin Cohort",
        status: "draft",
        capacity: 25,
      },
      inheritedContext: {
        project: { id: "project-1", name: "Helios CX Project" },
        blueprint: { id: "bp-1", name: "Helios Exam Blueprint" },
        snapshot: { id: "snap-1", name: "Default Snapshot" },
        policy: { id: "policy-1", name: "Standard Exam Policy" },
        allowedRegions: [
          { id: "region-1", name: "EU West" },
          { id: "region-2", name: "US East" },
        ],
        instructor: { id: "instructor-1", name: "Helios Service Account" },
        scoreRetrievalEnabled: true,
        timeLimitMinutes: 240,
      },
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.create",
    });
    expect(entry).toMatchObject({
      actor,
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      outcome: "success",
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-1",
        action: "cohort_exam_session.created",
        subjectType: "cohort_exam_session",
        subjectId: "cohort-session-1",
        examId: "exam-1",
      }),
    );
  });

  it("rejects draft Cohort Exam Session creation under individual-only Exams", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedExam(exams, { deliveryAvailability: "individual" });

    const response = await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );

    expect(response).toEqual({
      status: 409,
      body: { error: "Cohort Exam Sessions are not available for individual-only Exams." },
    });
    await expect(sessions.listByExamId("exam-1")).resolves.toEqual([]);
  });

  it("lists and views draft Cohort Exam Sessions under their parent Exam only", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    await seedExam(exams);
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        body: {
          name: "Open Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );

    const list = await handleListCohortExamSessions(
      { exams, sessions, logger: makeLogger() },
      { customerId: "customer-1", examId: "exam-1" },
    );
    const view = await handleGetCohortExamSession(
      { exams, sessions, logger: makeLogger() },
      { customerId: "customer-1", examId: "exam-1", sessionId: "cohort-session-1" },
    );
    const foreignCustomer = await handleGetCohortExamSession(
      { exams, sessions, logger: makeLogger() },
      { customerId: "customer-2", examId: "exam-1", sessionId: "cohort-session-1" },
    );

    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      sessions: [
        {
          session: { id: "cohort-session-1", status: "draft" },
          inheritedContext: { timeLimitMinutes: 240 },
        },
      ],
    });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      session: { id: "cohort-session-1", name: "Open Cohort" },
      inheritedContext: { instructor: { name: "Helios Service Account" } },
    });
    expect(foreignCustomer.status).toBe(404);
  });

  it("publishes a draft Cohort Exam Session to one shared CloudShare on-demand Experience", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const requestV3 = vi.fn(async (spec: { path?: string; schema: { parse(value: unknown): unknown } }) =>
      parseSuccessfulPublishV3(spec),
    );
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: Record<string, unknown>; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "EXcohort-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: {
          method: spec.method,
          path: "/v4" + spec.path,
          headers: { authorization: "Bearer secret-api-key" },
          body: spec.body,
        },
        response: {
          status: 201,
          headers: { "content-type": "application/json" },
          body: { id: "EXcohort-1", apiKeyEcho: "secret-api-key" },
        },
      }),
    );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV3,
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };
    await seedExam(exams);
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
          admissionEndsAt: "2026-07-31T17:00:00.000Z",
          capacity: 25,
        },
      },
    );

    const response = await handlePublishCohortExamSession(
      {
        exams,
        sessions,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
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
        audit,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T12:00:00.000Z"),
        newAuditId: () => "audit-parent-exam-published",
        newCorrelationId: () => "corr-cohort-publish-1",
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
        id: "cohort-session-1",
        status: "published",
        cloudShareTrainingId: "EXcohort-1",
        cloudShareExperienceId: "EXcohort-1",
        cloudShareTeamId: "TM-team-1",
        publishedAt: new Date("2026-07-04T12:00:00.000Z"),
      },
    });
    await expect(exams.findById("exam-1")).resolves.toMatchObject({
      status: "published",
      publishedAt: new Date("2026-07-04T12:00:00.000Z"),
    });
    expect(requestV4Detailed).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/trainings",
        body: expect.objectContaining({
          Name: "Helios CloudShare Fundamentals - July Admin Cohort",
          Start: "2026-07-05T09:00:00.000Z",
          End: "2026-07-31T17:00:00.000Z",
          Type: "selfPaced",
          ProjectId: "project-1",
          TeamId: "TM-team-1",
          BlueprintIds: ["bp-1"],
          PolicyId: "policy-1",
          CloudshareRegionIds: ["region-1", "region-2"],
          MainInstructor: { Email: "instructor-1" },
          TimeZone: "UTC",
          Passphrase: "certalis-cohort-session-1",
          RegistrationType: "registeredStudentsOnly",
          UsersEarlyAccess: { GrantEarlyAccess: 2 },
        }),
      }),
    );
    expect(requestV3).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/class/actions/customfields",
        query: { projectId: "project-1" },
      }),
    );
    const customFieldCallOrders = requestV3.mock.calls.flatMap((call, index) =>
      call[0].path === "/class/actions/customfields"
        ? [requestV3.mock.invocationCallOrder[index]]
        : [],
    );
    expect(customFieldCallOrders).toHaveLength(2);
    expect(customFieldCallOrders[0]).toBeLessThan(requestV4Detailed.mock.invocationCallOrder[0]);
    expect(customFieldCallOrders[1]).toBeGreaterThan(requestV4Detailed.mock.invocationCallOrder[0]);

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
    });
    expect(entry).toMatchObject({
      actor,
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      outcome: "success",
      correlationId: "corr-cohort-publish-1",
      externalIds: {
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
        teamId: "TM-team-1",
      },
      details: {
        integrationSurface: "cloudshare.v4.training",
        parentExamStatusChanged: true,
      },
    });
    expect(JSON.stringify(entry)).not.toContain("secret-api-key");
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-parent-exam-published",
        customerId: "customer-1",
        actorType: "admin",
        actorId: "admin-1",
        actorEmail: "admin@helioscx.demo",
        action: "exam.published",
        subjectType: "exam",
        subjectId: "exam-1",
        outcome: "success",
        examId: "exam-1",
        details: {
          changedFields: ["status", "publishedAt"],
          reason: "cohort_exam_session.publish",
          cohortExamSessionId: "cohort-session-1",
        },
        occurredAt: new Date("2026-07-04T12:00:00.000Z"),
      }),
    );
  });

  it("blocks publish before creating the shared Experience when the Blueprint default Snapshot drifted", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    await seedExam(exams);
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
          admissionEndsAt: "2026-07-31T17:00:00.000Z",
          capacity: 25,
        },
      },
    );
    const requestV3 = vi.fn(async (spec: { path: string; schema: { parse(value: unknown): unknown } }) => {
      if (spec.path === "/projects/project-1/blueprints/bp-1") {
        return spec.schema.parse({
          id: "bp-1",
          name: "Helios Exam Blueprint",
          createFromVersions: [
            {
              id: "snap-2",
              name: "Changed Default Snapshot",
              isDefault: true,
              Regions: ["region-1"],
            },
          ],
        });
      }
      if (spec.path === "/teams") {
        return spec.schema.parse({ rows: [{ id: "TM-team-1", name: "Helios Team" }] });
      }
      throw new Error(`unexpected v3 path ${spec.path}`);
    });
    const requestV4Detailed = vi.fn();
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV3,
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handlePublishCohortExamSession(
      {
        exams,
        sessions,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
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
        now: () => new Date("2026-07-04T12:00:00.000Z"),
        newCorrelationId: () => "corr-cohort-snapshot-drift",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response).toEqual({
      status: 423,
      body: {
        error:
          "Cohort Exam Session publish is temporarily unavailable because the lab configuration changed. Refresh CloudShare resources and check the Exam Blueprint/default Snapshot.",
        correlationId: "corr-cohort-snapshot-drift",
      },
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "draft",
      cloudShareTrainingId: null,
      cloudShareExperienceId: null,
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      actor,
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      correlationId: "corr-cohort-snapshot-drift",
      details: {
        failureMode: "snapshot_drift",
        savedSnapshotId: "snap-1",
        currentDefaultSnapshotId: "snap-2",
      },
    });
  });

  it("keeps a session recoverable and records diagnostics when CloudShare rejects publish", async () => {
    const { exams, sessions, diagnosticsRepository, deps, requestV4Detailed } = await makePublishFailureDeps(
      new CloudShareRequestError("CloudShare rejected the training", 400, {
        method: "POST",
        path: "/v4/trainings",
        integrationSurface: "cloudshare.v4.training",
        requestHeaders: { authorization: "Bearer secret-api-key" },
        requestBody: { Name: "July Admin Cohort", apiKey: "secret-api-key" },
        responseHeaders: { "content-type": "application/json" },
        responseBody: { Name: ["Experience name must be unique"], apiKeyEcho: "secret-api-key" },
      }),
    );

    const response = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "CloudShare could not publish this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
      correlationId: "corr-cohort-publish-failure",
    });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "draft",
      cloudShareTrainingId: null,
      lastPublishCorrelationId: "corr-cohort-publish-failure",
      lastPublishError: "CloudShare could not publish this Cohort Exam Session.",
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
    await expect(exams.findById("exam-1")).resolves.toMatchObject({ id: "exam-1" });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      correlationId: "corr-cohort-publish-failure",
      request: {
        method: "POST",
        path: "/v4/trainings",
        headers: { authorization: "[REDACTED]" },
        body: { Name: "July Admin Cohort", apiKey: "[REDACTED]" },
      },
      response: {
        status: 400,
        body: { Name: ["Experience name must be unique"], apiKeyEcho: "[REDACTED]" },
      },
      details: {
        integrationSurface: "cloudshare.v4.training",
        failureMode: "http_status",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("secret-api-key");

    const retry = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });
    expect(retry.status).toBe(502);
    expect(requestV4Detailed).toHaveBeenCalledTimes(2);
  });

  it("keeps a session recoverable and records diagnostics when CloudShare cannot resolve a Project Team", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedExam(exams);
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );
    const requestV3 = vi.fn(async (spec: { path?: string; schema: { parse(value: unknown): unknown } }) =>
      parseSuccessfulPublishV3(spec, []),
    );
    const requestV4Detailed = vi.fn();
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV3,
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handlePublishCohortExamSession(
      {
        exams,
        sessions,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
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
        now: () => new Date("2026-07-04T12:00:00.000Z"),
        newCorrelationId: () => "corr-cohort-team-failure",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "CloudShare could not publish this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
      correlationId: "corr-cohort-team-failure",
    });
    expect(requestV4Detailed).not.toHaveBeenCalled();
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "draft",
      cloudShareTrainingId: null,
      lastPublishCorrelationId: "corr-cohort-team-failure",
      lastPublishError: "CloudShare could not publish this Cohort Exam Session.",
    });

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      subject: { type: "cohort_exam_session", id: "cohort-session-1" },
      correlationId: "corr-cohort-team-failure",
      request: {
        method: "GET",
        path: "/teams",
        query: expect.objectContaining({ projectId: "project-1" }),
      },
      response: {
        body: { teamCount: 0 },
      },
      details: {
        integrationSurface: "cloudshare.v3.teams",
        failureMode: "unexpected_response",
        issues: ["No CloudShare Team was returned for Project project-1."],
      },
    });
    expect(JSON.stringify(entry)).not.toContain("secret-api-key");
  });

  it("does not mark the Cohort Exam Session published when parent Exam promotion fails after CloudShare create", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({
      repository: diagnosticsRepository,
      secrets: ["secret-api-key"],
    });
    await seedExam(exams, { deliveryAvailability: "cohort" });
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );
    const failingExams = {
      ...exams,
      save: vi.fn(async (exam: Parameters<typeof exams.save>[0]) => {
        if (exam.status === "published") {
          throw new Error("database unavailable");
        }
        await exams.save(exam);
      }),
    };
    const requestV3 = vi.fn(async (spec: { path?: string; schema: { parse(value: unknown): unknown } }) =>
      parseSuccessfulPublishV3(spec),
    );
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: Record<string, unknown>; schema: { parse(value: unknown): unknown } }) => ({
        data: spec.schema.parse({ id: "EXcohort-1" }),
        host: "api.accelerate.cloudshare.com",
        integrationSurface: "cloudshare.v4.training",
        request: {
          method: spec.method,
          path: "/v4" + spec.path,
          headers: { authorization: "Bearer secret-api-key" },
          body: spec.body,
        },
        response: {
          status: 201,
          headers: { "content-type": "application/json" },
          body: { id: "EXcohort-1" },
        },
      }),
    );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV3,
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };

    const response = await handlePublishCohortExamSession(
      {
        exams: failingExams,
        sessions,
        connections: {
          findByCustomerId: vi.fn(async () => ({
            customerId: "customer-1",
            apiId: "api-id",
            apiKey: "secret-api-key",
            webhookSecret: "webhook-secret",
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
        now: () => new Date("2026-07-04T12:00:00.000Z"),
        newCorrelationId: () => "corr-local-persist-failure",
      },
      {
        customerId: "customer-1",
        actor,
        examId: "exam-1",
        sessionId: "cohort-session-1",
      },
    );

    expect(response).toMatchObject({
      status: 500,
      body: {
        error:
          "Cohort Exam Session was created in CloudShare, but the portal could not persist the published state. Check the diagnostic log for the correlation ID.",
        correlationId: "corr-local-persist-failure",
      },
    });
    await expect(exams.findById("exam-1")).resolves.toMatchObject({ status: "draft" });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "publish_reconciliation_required",
      cloudShareTrainingId: "EXcohort-1",
      cloudShareExperienceId: "EXcohort-1",
      cloudShareTeamId: "TM-team-1",
      lastPublishCorrelationId: "corr-local-persist-failure",
      lastPublishError:
        "CloudShare Experience was created, but portal local publish state could not be fully persisted. Reconcile this Cohort Exam Session before retrying.",
    });
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
    });
    expect(entry).toMatchObject({
      outcome: "failure",
      correlationId: "corr-local-persist-failure",
      externalIds: {
        trainingId: "EXcohort-1",
        experienceId: "EXcohort-1",
        teamId: "TM-team-1",
      },
      details: {
        failureMode: "local_persistence",
        failedStage: "parent_exam_publish",
        parentExamStatusChanged: false,
      },
    });
    expect(JSON.stringify(entry)).not.toContain("secret-api-key");
  });

  it("allows only one concurrent publish call to create the CloudShare on-demand Experience", async () => {
    const exams = createInMemoryExamCatalogRepository();
    const sessions = createInMemoryCohortExamSessionRepository();
    const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
    const diagnostics = createDiagnosticRecorder({ repository: diagnosticsRepository });
    await seedExam(exams);
    await handleCreateDraftCohortExamSession(
      {
        exams,
        sessions,
        logger: makeLogger(),
        now: () => new Date("2026-07-04T11:00:00.000Z"),
        newId: () => "cohort-session-1",
      },
      {
        customerId: "customer-1",
        examId: "exam-1",
        body: {
          name: "July Admin Cohort",
          admissionStartsAt: "2026-07-05T09:00:00.000Z",
        },
      },
    );
    const requestV3 = vi.fn(async (spec: { path?: string; schema: { parse(value: unknown): unknown } }) =>
      parseSuccessfulPublishV3(spec),
    );
    const trainingPost = deferred<{
      data: unknown;
      host: string;
      integrationSurface: string;
      request: Record<string, unknown>;
      response: Record<string, unknown>;
    }>();
    const requestV4Detailed = vi.fn(
      async (spec: { method: string; path: string; body: Record<string, unknown>; schema: { parse(value: unknown): unknown } }) => {
        await trainingPost.promise;
        return {
          data: spec.schema.parse({ id: "EXcohort-1" }),
          host: "api.accelerate.cloudshare.com",
          integrationSurface: "cloudshare.v4.training",
          request: { method: spec.method, path: spec.path, body: spec.body },
          response: { status: 201, body: { id: "EXcohort-1" } },
        };
      },
    );
    const cloudshare: CloudShareClientFactory = {
      forConnection: () =>
        ({
          requestV3,
          requestV4Detailed,
        }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
    };
    const deps = {
      exams,
      sessions,
      connections: {
        findByCustomerId: vi.fn(async () => ({
          customerId: "customer-1",
          apiId: "api-id",
          apiKey: "secret-api-key",
          webhookSecret: "webhook-secret",
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
      now: () => new Date("2026-07-04T12:00:00.000Z"),
      newCorrelationId: vi.fn().mockReturnValueOnce("corr-concurrent-1").mockReturnValueOnce("corr-concurrent-2"),
    };

    const first = handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });
    const second = handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });
    await vi.waitFor(() => expect(requestV4Detailed).toHaveBeenCalledTimes(1));
    trainingPost.resolve({
      data: { id: "unused" },
      host: "api.accelerate.cloudshare.com",
      integrationSurface: "cloudshare.v4.training",
      request: {},
      response: {},
    });
    const responses = await Promise.all([first, second]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "published",
      cloudShareTrainingId: "EXcohort-1",
    });
    const entries = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ outcome: "success", correlationId: "corr-concurrent-1" });
  });

  it("blocks publish retry after an ambiguous CloudShare transport failure", async () => {
    const { diagnosticsRepository, sessions, deps, requestV4Detailed } = await makePublishFailureDeps(
      new CloudShareTransportError("CloudShare was unreachable", {
        method: "POST",
        path: "/v4/trainings",
        integrationSurface: "cloudshare.v4.training",
        requestHeaders: { authorization: "Bearer secret-api-key" },
        requestBody: { Name: "July Admin Cohort", apiKey: "secret-api-key" },
        cause: "ECONNRESET",
      }),
    );

    const response = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error:
        "CloudShare publish outcome is unknown. Reconcile it before retrying this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
      correlationId: "corr-cohort-publish-failure",
    });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "publish_reconciliation_required",
      lastPublishCorrelationId: "corr-cohort-publish-failure",
      lastPublishError:
        "CloudShare publish outcome is unknown. Reconcile this Cohort Exam Session before retrying.",
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      details: {
        integrationSurface: "cloudshare.v4.training",
        failureMode: "transport",
        cause: "ECONNRESET",
      },
      response: null,
    });
    expect(JSON.stringify(entry)).not.toContain("secret-api-key");

    const retry = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });
    expect(retry).toEqual({
      status: 409,
      body: {
        error:
          "The previous CloudShare publish attempt has an unknown outcome. Reconcile it before retrying this Cohort Exam Session.",
        correlationId: "corr-cohort-publish-failure",
      },
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
  });

  it("blocks publish retry after an ambiguous CloudShare create response mismatch", async () => {
    const { sessions, deps, requestV4Detailed } = await makePublishFailureDeps(
      new CloudShareResponseError("CloudShare response did not match the expected schema", {
        method: "POST",
        path: "/v4/trainings",
        integrationSurface: "cloudshare.v4.training",
        requestHeaders: { authorization: "Bearer secret-api-key" },
        requestBody: { Name: "July Admin Cohort" },
        responseHeaders: { "content-type": "application/json" },
        responseBody: { trainingName: "July Admin Cohort" },
        issues: ["Required"],
      }),
    );

    const response = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });

    expect(response.status).toBe(502);
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "publish_reconciliation_required",
      lastPublishCorrelationId: "corr-cohort-publish-failure",
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
  });

  it("blocks publish retry after an ambiguous CloudShare create 5xx response", async () => {
    const { diagnosticsRepository, sessions, deps, requestV4Detailed } = await makePublishFailureDeps(
      new CloudShareRequestError("Bad Gateway", 502, {
        method: "POST",
        path: "/v4/trainings",
        integrationSurface: "cloudshare.v4.training",
        requestHeaders: { authorization: "Bearer secret-api-key" },
        requestBody: { Name: "July Admin Cohort", apiKey: "secret-api-key" },
        responseHeaders: { "content-type": "application/json" },
        responseBody: { message: "upstream error", apiKeyEcho: "secret-api-key" },
      }),
    );

    const response = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error:
        "CloudShare publish outcome is unknown. Reconcile it before retrying this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
      correlationId: "corr-cohort-publish-failure",
    });
    await expect(sessions.findById("cohort-session-1")).resolves.toMatchObject({
      status: "publish_reconciliation_required",
      lastPublishCorrelationId: "corr-cohort-publish-failure",
      lastPublishError:
        "CloudShare publish outcome is unknown. Reconcile this Cohort Exam Session before retrying.",
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);

    const [entry] = await diagnosticsRepository.query({
      customerId: "customer-1",
      examId: "exam-1",
      operation: "cohort_exam_session.publish",
      outcome: "failure",
    });
    expect(entry).toMatchObject({
      correlationId: "corr-cohort-publish-failure",
      request: {
        method: "POST",
        path: "/v4/trainings",
        headers: { authorization: "[REDACTED]" },
        body: { Name: "July Admin Cohort", apiKey: "[REDACTED]" },
      },
      response: {
        status: 502,
        body: { message: "upstream error", apiKeyEcho: "[REDACTED]" },
      },
      details: {
        integrationSurface: "cloudshare.v4.training",
        failureMode: "http_status",
      },
    });
    expect(JSON.stringify(entry)).not.toContain("secret-api-key");

    const retry = await handlePublishCohortExamSession(deps, {
      customerId: "customer-1",
      actor,
      examId: "exam-1",
      sessionId: "cohort-session-1",
    });
    expect(retry).toEqual({
      status: 409,
      body: {
        error:
          "The previous CloudShare publish attempt has an unknown outcome. Reconcile it before retrying this Cohort Exam Session.",
        correlationId: "corr-cohort-publish-failure",
      },
    });
    expect(requestV4Detailed).toHaveBeenCalledTimes(1);
  });
});

async function makePublishFailureDeps(error: Error) {
  const exams = createInMemoryExamCatalogRepository();
  const sessions = createInMemoryCohortExamSessionRepository();
  const diagnosticsRepository = createInMemoryDiagnosticLogRepository();
  const diagnostics = createDiagnosticRecorder({
    repository: diagnosticsRepository,
    secrets: ["secret-api-key"],
  });
  await seedExam(exams);
  await handleCreateDraftCohortExamSession(
    {
      exams,
      sessions,
      logger: makeLogger(),
      now: () => new Date("2026-07-04T11:00:00.000Z"),
      newId: () => "cohort-session-1",
    },
    {
      customerId: "customer-1",
      examId: "exam-1",
      body: {
        name: "July Admin Cohort",
        admissionStartsAt: "2026-07-05T09:00:00.000Z",
      },
    },
  );
  const requestV3 = vi.fn(async (spec: { path?: string; schema: { parse(value: unknown): unknown } }) =>
    parseSuccessfulPublishV3(spec),
  );
  const requestV4Detailed = vi.fn(async () => {
    throw error;
  });
  const cloudshare: CloudShareClientFactory = {
    forConnection: () =>
      ({
        requestV3,
        requestV4Detailed,
      }) as unknown as ReturnType<CloudShareClientFactory["forConnection"]>,
  };
  return {
    exams,
    sessions,
    diagnosticsRepository,
    requestV4Detailed,
    deps: {
      exams,
      sessions,
      connections: {
        findByCustomerId: vi.fn(async () => ({
          customerId: "customer-1",
          apiId: "api-id",
          apiKey: "secret-api-key",
          webhookSecret: "webhook-secret",
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
      now: () => new Date("2026-07-04T12:00:00.000Z"),
      newCorrelationId: () => "corr-cohort-publish-failure",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
