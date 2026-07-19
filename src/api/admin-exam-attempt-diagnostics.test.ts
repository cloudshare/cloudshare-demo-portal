import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createDiagnosticRecorder,
  type DiagnosticLogRepository,
} from "@/domain/diagnostic-log";
import type {
  AdminExamAttemptDiagnosticContextRecord,
  AdminExamAttemptDiagnosticContextRepository,
} from "@/domain/admin-exam-attempt-diagnostics";
import { createInMemoryDiagnosticLogRepository } from "@/persistence/diagnostic-log-repository";
import type { Logger } from "@/observability/logger";
import {
  buildAdminExamAttemptDiagnosticDrilldownDeps,
  handleGetAdminExamAttemptDiagnosticDrilldown,
  refreshCloudShareEnvironmentStatus,
  type AdminExamAttemptDiagnosticDrilldownServices,
} from "./admin-exam-attempt-diagnostics";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeContextRepository(
  record: AdminExamAttemptDiagnosticContextRecord | null,
): AdminExamAttemptDiagnosticContextRepository {
  return {
    findByExamAttemptId: vi.fn().mockResolvedValue(record),
  };
}

const BASE_CONTEXT: AdminExamAttemptDiagnosticContextRecord = {
  attemptId: "attempt-1",
  customerId: "customer-a",
  attemptStatus: "suspended",
  scheduledFor: new Date("2026-06-21T09:00:00.000Z"),
  createdAt: new Date("2026-06-20T09:00:00.000Z"),
  candidateId: "candidate-1",
  candidateEmail: "candidate@helioscx.demo",
  candidateFirstName: "Casey",
  candidateLastName: "Rivera",
  examId: "exam-1",
  examTitle: "Helios CX Analyst",
  examStatus: "published",
  scoreRetrievalEnabled: true,
  trainingId: "training-1",
  experienceId: "experience-1",
  environmentExternalId: "env-external-1",
  environmentId: null,
  participantId: "participant-1",
  participantEmail: "candidate@helioscx.demo",
};

function makeDrilldownServices(
  diagnostics: DiagnosticLogRepository = createInMemoryDiagnosticLogRepository(),
): AdminExamAttemptDiagnosticDrilldownServices {
  return {
    adminExamAttemptDiagnosticContexts: makeContextRepository(BASE_CONTEXT),
    diagnostics,
    logger: makeLogger(),
    cloudshareConnections: {
      save: vi.fn(),
      markVerified: vi.fn(),
      findByCustomerId: vi.fn().mockResolvedValue(null),
      findByWebhookPathToken: vi.fn(),
    },
    cloudshareClientFactory: {
      forConnection: vi.fn().mockReturnValue({
        requestV3: vi.fn().mockResolvedValue({ status: "Running" }),
      }),
    },
    environments: {
      findByExternalId: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    },
    diagnosticRecorder: createDiagnosticRecorder({
      repository: diagnostics,
      secrets: [],
    }),
  };
}

describe("buildAdminExamAttemptDiagnosticDrilldownDeps", () => {
  it("maps the admin diagnostic drilldown dependencies from composed portal services", () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const services = makeDrilldownServices(diagnostics);

    const deps = buildAdminExamAttemptDiagnosticDrilldownDeps(services);

    expect(deps).toMatchObject({
      contexts: services.adminExamAttemptDiagnosticContexts,
      diagnostics,
      logger: services.logger,
    });
    expect(deps.refreshEnvironmentStatus).toEqual(expect.any(Function));
  });

  it("keeps the Next route adapter from constructing CloudShare environment refresh wiring", () => {
    const routeSource = readFileSync(
      "app/api/admin/diagnostics/attempts/[examAttemptId]/route.ts",
      "utf8",
    );

    expect(routeSource).toContain("buildAdminExamAttemptDiagnosticDrilldownDeps");
    expect(routeSource).not.toContain("createCloudShareEnvironmentSource");
    expect(routeSource).not.toContain("refreshCloudShareEnvironmentStatus");
    expect(routeSource).not.toContain("contexts: services.adminExamAttemptDiagnosticContexts");
  });
});

describe("refreshCloudShareEnvironmentStatus", () => {
  it("records a diagnostic when the Customer has no CloudShare Connection", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const services = makeDrilldownServices(diagnostics);

    await refreshCloudShareEnvironmentStatus(services, BASE_CONTEXT);

    expect(services.cloudshareConnections.findByCustomerId).toHaveBeenCalledWith("customer-a");
    expect(services.cloudshareClientFactory.forConnection).not.toHaveBeenCalled();
    expect(services.environments.save).not.toHaveBeenCalled();

    const entries = await diagnostics.query({
      customerId: "customer-a",
      examAttemptId: "attempt-1",
    });
    expect(entries).toEqual([
      expect.objectContaining({
        source: "admin-diagnostics",
        level: "warn",
        operation: "cloudshare.environment.reconcile",
        outcome: "failure",
        message: "CloudShare environment status refresh skipped: missing CloudShare Connection",
        externalIds: { environmentExternalId: "env-external-1" },
        details: expect.objectContaining({
          integrationSurface: "cloudshare.v3.env",
          refreshedBy: "admin_exam_attempt_diagnostics",
          reason: "missing_cloudshare_connection",
        }),
      }),
    ]);
  });

  it("polls CloudShare environment state, persists it, and records the refresh diagnostic", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const services = makeDrilldownServices(diagnostics);
    const connection = {
      customerId: "customer-a",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "webhook-secret",
      webhookPathToken: "webhook-token",
      connectedAt: new Date("2026-06-20T09:00:00.000Z"),
      verifiedAt: null,
    };
    services.cloudshareConnections.findByCustomerId = vi.fn().mockResolvedValue(connection);

    await refreshCloudShareEnvironmentStatus(services, BASE_CONTEXT);

    expect(services.cloudshareClientFactory.forConnection).toHaveBeenCalledWith(connection);
    expect(services.environments.save).toHaveBeenCalledWith({
      environmentExternalId: "env-external-1",
      status: "running",
      observedAt: expect.any(Date),
    });

    const entries = await diagnostics.query({
      customerId: "customer-a",
      examAttemptId: "attempt-1",
    });
    expect(entries).toEqual([
      expect.objectContaining({
        source: "admin-diagnostics",
        operation: "cloudshare.environment.reconcile",
        outcome: "success",
        message: "CloudShare environment status refreshed",
        externalIds: {
          environmentExternalId: "env-external-1",
          environmentStatus: "running",
        },
        request: { method: "GET", path: "/api/v3/envs/{envId}" },
        response: { status: 200, body: { status: "running" } },
        details: expect.objectContaining({
          integrationSurface: "cloudshare.v3.env",
          refreshedBy: "admin_exam_attempt_diagnostics",
          observedAt: expect.any(String),
        }),
      }),
    ]);
  });
});

describe("handleGetAdminExamAttemptDiagnosticDrilldown", () => {
  it("returns one customer-scoped drilldown with attempt context and chronological DiagnosticLogEntry timeline", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    await diagnostics.append({
      occurredAt: new Date("2026-06-21T10:05:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "failure",
      message: "Resume failed",
      customerId: "customer-a",
      examId: "exam-1",
      examAttemptId: "attempt-1",
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-2",
      externalIds: { environmentId: "env-1", trainingId: "training-1" },
      request: { method: "POST", path: "/api/exam/resume" },
      response: { status: 502 },
      details: {
        integrationSurface: "cloudshare.v3.env.action.resume",
        failureMode: "http_status",
      },
    });
    await diagnostics.append({
      occurredAt: new Date("2026-06-21T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.enter",
      outcome: "success",
      message: "Candidate entered exam",
      customerId: "customer-a",
      examId: "exam-1",
      examAttemptId: "attempt-1",
      candidateEmail: "candidate@helioscx.demo",
      correlationId: "corr-1",
      externalIds: { trainingId: "training-1" },
      request: { method: "GET", path: "/api/exam/enter" },
      response: { status: 302 },
      details: {
        integrationSurface: "portal.enter_redirect",
      },
    });
    await diagnostics.append({
      occurredAt: new Date("2026-06-21T10:10:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.resume",
      outcome: "success",
      message: "Other customer attempt",
      customerId: "customer-b",
      examId: "exam-2",
      examAttemptId: "attempt-1",
    });

    const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
      {
        contexts: makeContextRepository(BASE_CONTEXT),
        diagnostics,
        logger: makeLogger(),
      },
      { customerId: "customer-a", examAttemptId: "attempt-1" },
    );

    expect(response.status).toBe(200);
    const drilldown = response.body.drilldown!;
    expect(drilldown).toMatchObject({
      timelineSource: "diagnostic_log_entry",
      timelinePage: {
        limit: 500,
        returned: 2,
        hasMore: false,
      },
      attempt: {
        id: "attempt-1",
        status: "suspended",
        scheduledFor: "2026-06-21T09:00:00.000Z",
        createdAt: "2026-06-20T09:00:00.000Z",
      },
      candidate: {
        id: "candidate-1",
        email: "candidate@helioscx.demo",
        firstName: "Casey",
        lastName: "Rivera",
      },
      exam: {
        id: "exam-1",
        title: "Helios CX Analyst",
        status: "published",
        scoreRetrievalEnabled: true,
      },
      cloudShare: {
        trainingId: "training-1",
        experienceId: "experience-1",
        environmentExternalId: "env-external-1",
        environmentId: null,
        participantId: "participant-1",
      },
    });
    expect(drilldown.timeline).toHaveLength(2);
    expect(
      drilldown.timeline.map((entry: { occurredAt: string; operation: string }) => [
        entry.occurredAt,
        entry.operation,
      ]),
    ).toEqual([
      ["2026-06-21T10:00:00.000Z", "exam_attempt.enter"],
      ["2026-06-21T10:05:00.000Z", "exam_attempt.resume"],
    ]);
  });

  it("returns 404 when the attempt does not exist for the caller's customer", async () => {
    const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
      {
        contexts: makeContextRepository(null),
        diagnostics: createInMemoryDiagnosticLogRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-a", examAttemptId: "attempt-missing" },
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "ExamAttempt attempt-missing was not found for customer customer-a",
    });
  });

  it("uses DiagnosticLogEntry as the primary timeline source instead of legacy stitched streams", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
      {
        contexts: makeContextRepository(BASE_CONTEXT),
        diagnostics,
        logger: makeLogger(),
      },
      { customerId: "customer-a", examAttemptId: "attempt-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body.drilldown?.timelineSource).toBe("diagnostic_log_entry");
    expect(response.body.drilldown?.timelinePage).toEqual({
      limit: 500,
      returned: 0,
      hasMore: false,
    });
    expect(response.body.drilldown?.timeline).toEqual([]);
  });

  it("refreshes CloudShare environment status before reading the timeline so archived state is visible without a webhook", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();

    const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
      {
        contexts: makeContextRepository(BASE_CONTEXT),
        diagnostics,
        logger: makeLogger(),
        refreshEnvironmentStatus: vi.fn(async (context) => {
          await diagnostics.append({
            occurredAt: new Date("2026-06-21T10:12:00.000Z"),
            source: "admin-diagnostics",
            operation: "cloudshare.environment.reconcile",
            outcome: "success",
            message: "CloudShare environment status refreshed",
            customerId: context.customerId,
            examId: context.examId,
            examAttemptId: context.attemptId,
            candidateEmail: context.candidateEmail,
            externalIds: {
              environmentExternalId: context.environmentExternalId ?? context.environmentId ?? "",
              environmentStatus: "archived",
            },
            request: {
              method: "GET",
              path: "/api/v3/envs/{envId}",
            },
            response: {
              status: 200,
              body: { status: "Archived" },
            },
            details: {
              integrationSurface: "cloudshare.v3.env",
              refreshedBy: "admin_exam_attempt_diagnostics",
            },
          });
        }),
      },
      { customerId: "customer-a", examAttemptId: "attempt-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body.drilldown?.timeline).toEqual([
      expect.objectContaining({
        operation: "cloudshare.environment.reconcile",
        outcome: "success",
        message: "CloudShare environment status refreshed",
        externalIds: expect.objectContaining({
          environmentExternalId: "env-external-1",
          environmentStatus: "archived",
        }),
      }),
    ]);
  });

  it("returns redacted structured details while preserving admin-only loginUrl diagnostic evidence", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();
    const recorder = createDiagnosticRecorder({
      repository: diagnostics,
      secrets: ["api-key-secret", "bearer-secret-token", "whsec-secret", "nonce-hmac-secret"],
    });

    await recorder.record({
      occurredAt: new Date("2026-06-21T10:00:00.000Z"),
      source: "runtime",
      operation: "exam_attempt.schedule",
      outcome: "failure",
      message: "Scheduling failed with bearer-secret-token",
      customerId: "customer-a",
      examId: "exam-1",
      examAttemptId: "attempt-1",
      request: {
        method: "POST",
        path: "/api/candidate/schedule",
        headers: {
          authorization: "Bearer bearer-secret-token",
          "x-api-key": "api-key-secret",
        },
      },
      details: {
        webhookSecret: "whsec-secret",
        nonceHmac: "nonce-hmac-secret",
        responseBody: {
          loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
        },
      },
    });

    const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
      {
        contexts: makeContextRepository(BASE_CONTEXT),
        diagnostics,
        logger: makeLogger(),
      },
      { customerId: "customer-a", examAttemptId: "attempt-1" },
    );

    expect(response.status).toBe(200);
    const [entry] = response.body.drilldown!.timeline;
    expect(entry.message).toBe("Scheduling failed with bearer-secret-token");
    expect(entry.request).toMatchObject({
      method: "POST",
      path: "/api/candidate/schedule",
      headers: {
        authorization: "[REDACTED]",
        "x-api-key": "[REDACTED]",
      },
    });
    expect(entry.details).toMatchObject({
      webhookSecret: "whsec-secret",
      nonceHmac: "nonce-hmac-secret",
      responseBody: {
        loginUrl: "https://use.cloudshare.com/Ent/Login.aspx?token=admin-evidence",
      },
    });
  });

  it("reports when older timeline rows exist beyond the drilldown cap", async () => {
    const diagnostics = createInMemoryDiagnosticLogRepository();

    for (let index = 0; index < 501; index += 1) {
      await diagnostics.append({
        occurredAt: new Date(Date.UTC(2026, 5, 21, 10, 0, index)),
        source: "runtime",
        operation: `exam_attempt.event_${index}`,
        outcome: "success",
        message: `Diagnostic ${index}`,
        customerId: "customer-a",
        examId: "exam-1",
        examAttemptId: "attempt-1",
      });
    }

    const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
      {
        contexts: makeContextRepository(BASE_CONTEXT),
        diagnostics,
        logger: makeLogger(),
      },
      { customerId: "customer-a", examAttemptId: "attempt-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body.drilldown?.timelinePage).toEqual({
      limit: 500,
      returned: 500,
      hasMore: true,
    });
  });
});
