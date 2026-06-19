import { describe, expect, it, vi } from "vitest";
import { handleGetAdminMonitoring } from "./admin-monitoring";
import type { AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type { Logger } from "@/observability/logger";
import type { AdminMonitoringAttemptRepository } from "@/domain/admin-monitoring";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeAttemptRepository(records: Awaited<ReturnType<AdminMonitoringAttemptRepository["listByCustomerId"]>>): AdminMonitoringAttemptRepository {
  return {
    listByCustomerId: vi.fn().mockResolvedValue(records),
  };
}

function makeAuditRepository(records: unknown[]): AuditRepository {
  return {
    write: vi.fn(),
    listByExamAttemptId: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

function makeEventLog(records: unknown[]): EventLogRepository {
  return {
    append: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

describe("handleGetAdminMonitoring", () => {
  it("returns grouped current attempts and history for the admin customer", async () => {
    const response = await handleGetAdminMonitoring(
      {
        attempts: makeAttemptRepository([
          {
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
            trainingId: "training-1",
            experienceId: "experience-1",
            environmentExternalId: "env-1",
            participantId: "participant-1",
            scoreRetrievalEnabled: false,
          },
        ]),
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
      }),
    });
  });
});
