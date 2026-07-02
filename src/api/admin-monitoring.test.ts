import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildAdminMonitoringDeps,
  handleGetAdminMonitoring,
  type AdminMonitoringServices,
} from "./admin-monitoring";
import type {
  AdminMonitoringAttemptRepository,
  AdminMonitoringSummary,
  MonitoringAttemptPage,
  MonitoringAttemptRecord,
} from "@/domain/admin-monitoring";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticLogEntry, DiagnosticLogRepository } from "@/domain/diagnostic-log";
import { CloudShareRequestError } from "@/integrations/cloudshare";
import type { Logger } from "@/observability/logger";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeAttempt(partial: Partial<MonitoringAttemptRecord> = {}): MonitoringAttemptRecord {
  return {
    id: "attempt-1",
    customerId: "customer-1",
    candidateId: "candidate-1",
    candidateEmail: "candidate@helioscx.demo",
    candidateFirstName: "Casey",
    candidateLastName: "Rivera",
    examId: "exam-1",
    examTitle: "Helios Exam",
    examOpenPeriodMinutes: 90,
    status: "scheduled",
    scheduledFor: new Date("2099-06-19T09:00:00.000Z"),
    createdAt: new Date("2099-06-18T09:00:00.000Z"),
    trainingId: null,
    experienceId: null,
    environmentExternalId: null,
    participantId: null,
    scoreRetrievalEnabled: false,
    ...partial,
  };
}

function makeSummary(partial: Partial<AdminMonitoringSummary> = {}): AdminMonitoringSummary {
  return {
    scheduled: 0,
    ready: 0,
    inProgress: 0,
    suspended: 0,
    completed: 0,
    expired: 0,
    ...partial,
  };
}

function makeAttemptRepository(overrides?: {
  readonly summary?: AdminMonitoringSummary;
  readonly currentAttempts?: MonitoringAttemptRecord[];
  readonly history?: MonitoringAttemptPage;
}): AdminMonitoringAttemptRepository {
  return {
    countSummaryByCustomerId: vi
      .fn()
      .mockResolvedValue(overrides?.summary ?? makeSummary({ scheduled: 1 })),
    listCurrentByCustomerId: vi
      .fn()
      .mockResolvedValue(overrides?.currentAttempts ?? [makeAttempt()]),
    listHistoryPageByCustomerId: vi.fn().mockResolvedValue(
      overrides?.history ?? {
        attempts: [],
        total: 0,
        limit: 25,
        offset: 0,
      },
    ),
  };
}

function makeDiagnosticEntry(
  partial: Partial<DiagnosticLogEntry> = {},
): DiagnosticLogEntry {
  return {
    id: "diag-1",
    occurredAt: new Date("2026-06-18T09:02:00.000Z"),
    level: "info",
    source: "runtime",
    operation: "exam_attempt.schedule",
    outcome: "success",
    customerId: "customer-1",
    actor: null,
    subject: { type: "exam_attempt", id: "attempt-1" },
    message: "ExamAttempt scheduled",
    correlationId: "corr-1",
    candidateEmail: "candidate@helioscx.demo",
    examId: "exam-1",
    examAttemptId: "attempt-1",
    externalIds: null,
    request: null,
    response: null,
    details: null,
    ...partial,
  };
}

function makeDiagnosticRepository(recordsByAttemptId: Record<string, DiagnosticLogEntry[]> = {}): DiagnosticLogRepository {
  return {
    append: vi.fn(),
    query: vi.fn().mockImplementation(async (query) => {
      if (!query?.examAttemptId) {
        return [];
      }
      return recordsByAttemptId[query.examAttemptId] ?? [];
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
    connectedAt: new Date("2026-06-18T08:00:00.000Z"),
    verifiedAt: new Date("2026-06-18T08:05:00.000Z"),
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

describe("handleGetAdminMonitoring", () => {
  it("maps admin monitoring dependencies from composed portal services", () => {
    const services = {
      adminMonitoringAttempts: makeAttemptRepository(),
      diagnostics: makeDiagnosticRepository(),
      logger: makeLogger(),
    } satisfies AdminMonitoringServices;

    const deps = buildAdminMonitoringDeps(services);

    expect(deps).toEqual({
      attempts: services.adminMonitoringAttempts,
      diagnostics: services.diagnostics,
      logger: services.logger,
    });
  });

  it("keeps the Next route adapter from inlining admin monitoring wiring", () => {
    const routeSource = readFileSync("app/api/admin/monitoring/route.ts", "utf8");

    expect(routeSource).toContain("buildAdminMonitoringDeps");
    expect(routeSource).not.toContain("attempts: services.adminMonitoringAttempts");
    expect(routeSource).not.toContain("diagnostics: services.diagnostics");
  });

  it("reconstructs visible attempt timelines from persisted diagnostics", async () => {
    const attempts = makeAttemptRepository({
      summary: makeSummary({
        scheduled: 1,
        completed: 1,
      }),
      currentAttempts: [makeAttempt({ id: "attempt-current" })],
      history: {
        attempts: [
          makeAttempt({
            id: "attempt-history-1",
            status: "completed",
          }),
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
    });
    const diagnostics = makeDiagnosticRepository({
      "attempt-current": [
        makeDiagnosticEntry({
          id: "diag-current-scheduled",
          examAttemptId: "attempt-current",
          operation: "exam_attempt.schedule",
          message: "ExamAttempt scheduled",
        }),
      ],
      "attempt-history-1": [
        makeDiagnosticEntry({
          id: "diag-history-enter",
          examAttemptId: "attempt-history-1",
          occurredAt: new Date("2026-06-18T09:03:00.000Z"),
          operation: "exam_attempt.enter",
          message: "Candidate entered exam - redirecting to CloudShare",
        }),
        makeDiagnosticEntry({
          id: "diag-history-complete",
          examAttemptId: "attempt-history-1",
          occurredAt: new Date("2026-06-18T09:04:00.000Z"),
          operation: "exam_attempt.complete",
          message: "Exam completed",
        }),
      ],
    });

    const response = await handleGetAdminMonitoring(
      {
        attempts,
        diagnostics,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
      },
    );

    expect(response.status).toBe(200);
    expect(attempts.countSummaryByCustomerId).toHaveBeenCalledWith("customer-1");
    expect(attempts.listCurrentByCustomerId).toHaveBeenCalledWith("customer-1");
    expect(attempts.listHistoryPageByCustomerId).toHaveBeenCalledWith("customer-1", {
      limit: 25,
      offset: 0,
    });
    expect(diagnostics.query).toHaveBeenCalledTimes(2);
    expect(diagnostics.query).toHaveBeenNthCalledWith(1, {
      customerId: "customer-1",
      examAttemptId: "attempt-current",
      limit: 500,
    });
    expect(diagnostics.query).toHaveBeenNthCalledWith(2, {
      customerId: "customer-1",
      examAttemptId: "attempt-history-1",
      limit: 500,
    });
    expect(response.body.monitoring.currentAttempts.scheduled[0]?.timeline).toEqual([
      expect.objectContaining({
        id: "diag-current-scheduled",
        operation: "exam_attempt.schedule",
      }),
    ]);
    expect(response.body.monitoring.history[0]?.timeline).toEqual([
      expect.objectContaining({
        id: "diag-history-enter",
        operation: "exam_attempt.enter",
      }),
      expect.objectContaining({
        id: "diag-history-complete",
        operation: "exam_attempt.complete",
      }),
    ]);
  });

  it("returns grouped current attempts and history for the admin customer", async () => {
    const response = await handleGetAdminMonitoring(
      {
        attempts: makeAttemptRepository({
          summary: makeSummary({ scheduled: 1 }),
          currentAttempts: [
            makeAttempt({
              id: "attempt-1",
              trainingId: "training-1",
              experienceId: "experience-1",
              environmentExternalId: "env-1",
              participantId: "participant-1",
            }),
          ],
        }),
        diagnostics: makeDiagnosticRepository(),
        logger: makeLogger(),
      },
      { customerId: "customer-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      monitoring: expect.objectContaining({
        summary: {
          scheduled: 1,
          ready: 0,
          inProgress: 0,
          suspended: 0,
          completed: 0,
          expired: 0,
        },
        currentAttempts: expect.objectContaining({
          scheduled: [
            expect.objectContaining({
              id: "attempt-1",
              examTitle: "Helios Exam",
            }),
          ],
        }),
        history: [],
        historyPage: {
          limit: 25,
          offset: 0,
          returned: 0,
          total: 0,
          hasMore: false,
          nextOffset: null,
        },
      }),
    });
  });

  it("keeps expired provisioning failures in monitoring history without surfacing a volatile timeline", async () => {
    const response = await handleGetAdminMonitoring(
      {
        attempts: makeAttemptRepository({
          summary: makeSummary({ expired: 1 }),
          currentAttempts: [],
          history: {
            attempts: [
              makeAttempt({
                id: "attempt-failed",
                status: "expired",
              }),
            ],
            total: 1,
            limit: 25,
            offset: 0,
          },
        }),
        diagnostics: makeDiagnosticRepository({
          "attempt-failed": [
            makeDiagnosticEntry({
              id: "diag-attempt-failed",
              examAttemptId: "attempt-failed",
              level: "warn",
              operation: "cloudshare.add_participant",
              outcome: "failure",
              message: "CloudShare add participant failed",
              details: {
                attemptedOperation: "add_participant",
                integrationSurface: "cloudshare.v4.training.participant",
                method: "POST",
                path: "/v4/trainings/training-1/students",
                failureMode: "http_status",
                responseStatus: 403,
              },
            }),
          ],
        }),
        logger: makeLogger(),
      },
      { customerId: "customer-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body.monitoring.summary).toEqual({
      scheduled: 0,
      ready: 0,
      inProgress: 0,
      suspended: 0,
      completed: 0,
      expired: 1,
    });
    expect(response.body.monitoring.history).toEqual([
      expect.objectContaining({
        id: "attempt-failed",
        status: "expired",
        timeline: [
          expect.objectContaining({
            id: "diag-attempt-failed",
            operation: "cloudshare.add_participant",
            outcome: "failure",
          }),
        ],
      }),
    ]);
  });

  it("shows an externally expired current attempt in history instead of leaving it suspended", async () => {
    const launches = {
      save: vi.fn(),
      findById: vi.fn(),
      findByExamAttemptId: vi.fn().mockResolvedValue({
        id: "launch-1",
        examAttemptId: "attempt-1",
        candidateId: "candidate-1",
        participantEmail: "candidate@helioscx.demo",
        trainingId: "EXtraining-1",
        experienceId: "EXtraining-1",
        environmentExternalId: "ENVS-expired-1",
        environmentId: "ENVS-expired-1",
        loginUrl: "https://use.cloudshare.com/demo",
        status: "launched",
        createdAt: new Date("2026-06-18T08:55:00.000Z"),
      }),
      findByCustomerIdAndEnvironmentExternalId: vi.fn(),
    };

    const response = await handleGetAdminMonitoring(
      {
        attempts: makeAttemptRepository({
          summary: makeSummary({ suspended: 1 }),
          currentAttempts: [
            makeAttempt({
              status: "suspended",
              scheduledFor: new Date("2026-06-18T08:00:00.000Z"),
              trainingId: "EXtraining-1",
              experienceId: "EXtraining-1",
              environmentExternalId: "ENVS-expired-1",
            }),
          ],
        }),
        diagnostics: makeDiagnosticRepository(),
        logger: makeLogger(),
        launches,
        connections: makeConnectionRepository(),
        cloudshare: makeCloudShareFactory({
          requestV3: vi.fn(async (spec: { path: string }) => {
            if (spec.path === "/envs/ENVS-expired-1") {
              throw new CloudShareRequestError("not found", 404, {
                method: "GET",
                path: "/v3/envs/ENVS-expired-1",
                integrationSurface: "cloudshare.v3.env.get",
              });
            }
            throw new Error(`unexpected path ${spec.path}`);
          }) as never,
        }),
        now: () => new Date("2026-06-18T10:00:00.000Z"),
      },
      { customerId: "customer-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body.monitoring.summary).toEqual({
      scheduled: 0,
      ready: 0,
      inProgress: 0,
      suspended: 0,
      completed: 0,
      expired: 1,
    });
    expect(response.body.monitoring.currentAttempts.suspended).toEqual([]);
    expect(response.body.monitoring.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "attempt-1",
          status: "expired",
        }),
      ]),
    );
  });
});
