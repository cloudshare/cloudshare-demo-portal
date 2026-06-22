import { describe, expect, it, vi } from "vitest";
import { handleGetAdminMonitoring } from "./admin-monitoring";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  AdminMonitoringAttemptRepository,
  AdminMonitoringSummary,
  MonitoringAttemptPage,
  MonitoringAttemptRecord,
} from "@/domain/admin-monitoring";
import type { EventLogRepository } from "@/domain/event-log";
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
    status: "scheduled",
    scheduledFor: new Date("2026-06-19T09:00:00.000Z"),
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
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

function makeAuditRepository(records: unknown[] = []): AuditRepository {
  return {
    write: vi.fn(),
    listByExamAttemptId: vi.fn(),
    listByExamAttemptIds: vi.fn().mockResolvedValue(records),
    listAll: vi.fn(),
  };
}

function makeEventLog(records: unknown[] = []): EventLogRepository {
  return {
    append: vi.fn(),
    listFailureEventsByExamAttemptIds: vi.fn().mockResolvedValue(records),
    listAll: vi.fn(),
  };
}

describe("handleGetAdminMonitoring", () => {
  it("requests summary, current queues, and the terminal-history page separately, and only loads timelines for rendered attempts", async () => {
    const attempts = makeAttemptRepository({
      summary: makeSummary({
        scheduled: 1,
        completed: 3,
        expired: 2,
      }),
      currentAttempts: [makeAttempt({ id: "attempt-current" })],
      history: {
        attempts: [
          makeAttempt({
            id: "attempt-history-2",
            status: "completed",
          }),
          makeAttempt({
            id: "attempt-history-1",
            status: "expired",
          }),
        ],
        total: 5,
        limit: 2,
        offset: 1,
      },
    });
    const audit = makeAuditRepository([]);
    const eventLog = makeEventLog([]);

    const response = await handleGetAdminMonitoring(
      {
        attempts,
        audit,
        eventLog,
        logger: makeLogger(),
      },
      {
        customerId: "customer-1",
        query: {
          historyLimit: "2",
          historyOffset: "1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(attempts.countSummaryByCustomerId).toHaveBeenCalledWith("customer-1");
    expect(attempts.listCurrentByCustomerId).toHaveBeenCalledWith("customer-1");
    expect(attempts.listHistoryPageByCustomerId).toHaveBeenCalledWith("customer-1", {
      limit: 2,
      offset: 1,
    });
    expect(audit.listByExamAttemptIds).toHaveBeenCalledWith([
      "attempt-current",
      "attempt-history-2",
      "attempt-history-1",
    ]);
    expect(eventLog.listFailureEventsByExamAttemptIds).toHaveBeenCalledWith([
      "attempt-current",
      "attempt-history-2",
      "attempt-history-1",
    ]);
    expect(response.body.monitoring.historyPage).toEqual({
      limit: 2,
      offset: 1,
      returned: 2,
      total: 5,
      hasMore: true,
      nextOffset: 3,
    });
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
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
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

  it("includes an expired provisioning failure attempt in monitoring history with its failure timeline", async () => {
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
        audit: makeAuditRepository([
          {
            id: "attempt-failed:audit",
            examAttemptId: "attempt-failed",
            candidateId: "candidate-1",
            action: "lab_launch_failed",
            outcome: "failure",
            details: {
              attemptedOperation: "add_participant",
              integrationSurface: "cloudshare.v4.training.participant",
              method: "POST",
              path: "/v4/trainings/training-1/students",
              failureMode: "http_status",
              responseStatus: 403,
            },
            error: "CloudShare provisioning failed for the scheduled exam.",
            occurredAt: new Date("2026-06-18T09:02:00.000Z"),
          },
        ]),
        eventLog: makeEventLog([]),
        logger: makeLogger(),
      },
      { customerId: "customer-1" },
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      monitoring: expect.objectContaining({
        summary: {
          scheduled: 0,
          ready: 0,
          inProgress: 0,
          suspended: 0,
          completed: 0,
          expired: 1,
        },
        history: [
          expect.objectContaining({
            id: "attempt-failed",
            status: "expired",
            timeline: [
              expect.objectContaining({
                kind: "audit",
                action: "lab_launch_failed",
                outcome: "failure",
              }),
            ],
          }),
        ],
      }),
    });
  });
});
