import { describe, expect, it, vi } from "vitest";
import { handleGetSupportWorkbench } from "./support-workbench";
import type { SupportLogRepository } from "@/domain/support-log";
import type { Logger } from "@/observability/logger";
import type { AdminMonitoringAttemptRepository } from "@/domain/admin-monitoring";
import type { AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeAttemptRepository(
  records: Awaited<ReturnType<AdminMonitoringAttemptRepository["listByCustomerId"]>>,
): AdminMonitoringAttemptRepository {
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

function makeSupportLog(
  records: Awaited<ReturnType<SupportLogRepository["listAll"]>>,
): SupportLogRepository {
  return {
    append: vi.fn(),
    listAll: vi.fn().mockResolvedValue(records),
  };
}

describe("handleGetSupportWorkbench", () => {
  it("returns filtered summary counts, bounded queue results, and matching attempts newest first", async () => {
    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository([
          {
            id: "attempt-in-progress-morgan",
            customerId: "customer-helios",
            candidateId: "candidate-1",
            candidateEmail: "morgan.lee@helioscx.demo",
            candidateFirstName: "Morgan",
            candidateLastName: "Lee",
            examId: "exam-1",
            examTitle: "Helios CX Fundamentals",
            status: "in_progress",
            scheduledFor: new Date("2026-06-22T09:00:00.000Z"),
            createdAt: new Date("2026-06-21T09:00:00.000Z"),
            trainingId: "training-1",
            experienceId: "experience-1",
            environmentExternalId: "env-1",
            participantId: "participant-1",
            scoreRetrievalEnabled: false,
          },
          {
            id: "attempt-ready-casey",
            customerId: "customer-helios",
            candidateId: "candidate-2",
            candidateEmail: "casey.rivera@helioscx.demo",
            candidateFirstName: "Casey",
            candidateLastName: "Rivera",
            examId: "exam-1",
            examTitle: "Helios CX Fundamentals",
            status: "ready",
            scheduledFor: new Date("2026-06-21T11:00:00.000Z"),
            createdAt: new Date("2026-06-20T09:00:00.000Z"),
            trainingId: "training-2",
            experienceId: "experience-2",
            environmentExternalId: "env-2",
            participantId: "participant-2",
            scoreRetrievalEnabled: false,
          },
          {
            id: "attempt-scheduled-morgan",
            customerId: "customer-helios",
            candidateId: "candidate-1",
            candidateEmail: "morgan.lee@helioscx.demo",
            candidateFirstName: "Morgan",
            candidateLastName: "Lee",
            examId: "exam-1",
            examTitle: "Helios CX Fundamentals",
            status: "scheduled",
            scheduledFor: new Date("2026-06-20T10:00:00.000Z"),
            createdAt: new Date("2026-06-19T09:00:00.000Z"),
            trainingId: "training-3",
            experienceId: "experience-3",
            environmentExternalId: "env-3",
            participantId: "participant-3",
            scoreRetrievalEnabled: false,
          },
          {
            id: "attempt-scheduled-morgan-older",
            customerId: "customer-helios",
            candidateId: "candidate-1",
            candidateEmail: "morgan.lee@helioscx.demo",
            candidateFirstName: "Morgan",
            candidateLastName: "Lee",
            examId: "exam-1",
            examTitle: "Helios CX Fundamentals",
            status: "scheduled",
            scheduledFor: new Date("2026-06-19T10:00:00.000Z"),
            createdAt: new Date("2026-06-18T09:00:00.000Z"),
            trainingId: "training-4",
            experienceId: "experience-4",
            environmentExternalId: "env-4",
            participantId: "participant-4",
            scoreRetrievalEnabled: false,
          },
          {
            id: "attempt-other-exam",
            customerId: "customer-helios",
            candidateId: "candidate-3",
            candidateEmail: "alex.chen@helioscx.demo",
            candidateFirstName: "Alex",
            candidateLastName: "Chen",
            examId: "exam-2",
            examTitle: "Security Lab",
            status: "suspended",
            scheduledFor: new Date("2026-06-20T09:30:00.000Z"),
            createdAt: new Date("2026-06-18T08:30:00.000Z"),
            trainingId: "training-5",
            experienceId: "experience-5",
            environmentExternalId: "env-5",
            participantId: "participant-5",
            scoreRetrievalEnabled: false,
          },
        ]),
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
        supportLog: makeSupportLog([
          {
            timestamp: new Date("2026-06-20T10:00:00.000Z"),
            level: "warn",
            message: "cloudshare webhook rejected: missing signature",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-helios",
              webhookPathToken: "whk-helios",
              method: "POST",
              path: "/api/webhooks/cloudshare/whk-helios",
              requestBodyBytes: 123,
              rawBodySha256: "abc123",
              signaturePresent: false,
              rawRequestBody: "{\"Event\":\"environment.created\"}",
            },
          },
        ]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {
          candidate: "morgan",
          examId: "exam-1",
          scheduledFrom: "2026-06-19T00:00:00.000Z",
          scheduledTo: "2026-06-22T23:59:59.999Z",
          limit: "2",
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.summary).toEqual({
      scheduled: 2,
      ready: 0,
      inProgress: 1,
      suspended: 0,
      completed: 0,
      expired: 0,
    });
    expect(result.body.meta).toEqual({
      totalMatchingAttempts: 3,
      limit: 2,
      returnedAttempts: 2,
      defaultLimitApplied: false,
      currentQueueLimit: 2,
      currentQueueTotals: {
        scheduled: 2,
        ready: 0,
        inProgress: 1,
        suspended: 0,
      },
    });
    expect(result.body.currentQueues).toEqual({
      scheduled: [
        expect.objectContaining({
          id: "attempt-scheduled-morgan",
          candidateName: "Morgan Lee",
        }),
        expect.objectContaining({
          id: "attempt-scheduled-morgan-older",
        }),
      ],
      ready: [],
      inProgress: [
        expect.objectContaining({
          id: "attempt-in-progress-morgan",
        }),
      ],
      suspended: [],
    });
    expect(result.body.matchingAttempts).toEqual([
      expect.objectContaining({ id: "attempt-in-progress-morgan" }),
      expect.objectContaining({ id: "attempt-scheduled-morgan" }),
    ]);
    expect(result.body.diagnostics).toHaveLength(1);
    expect(result.body.diagnostics[0]).toEqual(
      expect.objectContaining({
        rawRequestBody: null,
      }),
    );
  });

  it("uses a bounded default limit and supports status-specific filtering", async () => {
    const attempts = Array.from({ length: 55 }, (_, index) => ({
      id: `attempt-${index + 1}`,
      customerId: "customer-helios",
      candidateId: `candidate-${index + 1}`,
      candidateEmail: `candidate-${index + 1}@helioscx.demo`,
      candidateFirstName: "Casey",
      candidateLastName: `${index + 1}`,
      examId: "exam-1",
      examTitle: "Helios CX Fundamentals",
      status: index < 52 ? ("completed" as const) : ("suspended" as const),
      scheduledFor: new Date(`2026-06-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`),
      createdAt: new Date(`2026-05-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`),
      trainingId: `training-${index + 1}`,
      experienceId: `experience-${index + 1}`,
      environmentExternalId: `env-${index + 1}`,
      participantId: `participant-${index + 1}`,
      scoreRetrievalEnabled: false,
    }));

    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository(attempts),
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
        supportLog: makeSupportLog([]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {
          status: "completed",
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.summary).toEqual({
      scheduled: 0,
      ready: 0,
      inProgress: 0,
      suspended: 0,
      completed: 52,
      expired: 0,
    });
    expect(result.body.meta).toEqual({
      totalMatchingAttempts: 52,
      limit: 50,
      returnedAttempts: 50,
      defaultLimitApplied: true,
      currentQueueLimit: 50,
      currentQueueTotals: {
        scheduled: 0,
        ready: 0,
        inProgress: 0,
        suspended: 0,
      },
    });
    expect(result.body.currentQueues).toEqual({
      scheduled: [],
      ready: [],
      inProgress: [],
      suspended: [],
    });
    expect(result.body.matchingAttempts).toHaveLength(50);
    expect(result.body.matchingAttempts[0]?.id).toBe("attempt-28");
  });

  it("bounds current queues with the same limit and reports when queue payloads are truncated", async () => {
    const attempts = Array.from({ length: 1000 }, (_, index) => ({
      id: `attempt-${index + 1}`,
      customerId: "customer-helios",
      candidateId: `candidate-${index + 1}`,
      candidateEmail: `candidate-${index + 1}@helioscx.demo`,
      candidateFirstName: "Queue",
      candidateLastName: `${index + 1}`,
      examId: "exam-1",
      examTitle: "Helios CX Fundamentals",
      status: "scheduled" as const,
      scheduledFor: new Date(`2026-06-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`),
      createdAt: new Date(`2026-05-${String((index % 28) + 1).padStart(2, "0")}T09:00:00.000Z`),
      trainingId: `training-${index + 1}`,
      experienceId: `experience-${index + 1}`,
      environmentExternalId: `env-${index + 1}`,
      participantId: `participant-${index + 1}`,
      scoreRetrievalEnabled: false,
    }));

    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository(attempts),
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
        supportLog: makeSupportLog([]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {
          limit: "25",
        },
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.currentQueues.scheduled).toHaveLength(25);
    expect(result.body.matchingAttempts).toHaveLength(25);
    expect(result.body.meta).toEqual({
      totalMatchingAttempts: 1000,
      limit: 25,
      returnedAttempts: 25,
      defaultLimitApplied: false,
      currentQueueLimit: 25,
      currentQueueTotals: {
        scheduled: 1000,
        ready: 0,
        inProgress: 0,
        suspended: 0,
      },
    });
  });

  it("redacts sensitive matching-attempt details and unknown-target webhook bodies", async () => {
    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository([
          {
            id: "attempt-1",
            customerId: "customer-helios",
            candidateId: "candidate-1",
            candidateEmail: "candidate@helioscx.demo",
            candidateFirstName: "Casey",
            candidateLastName: "Rivera",
            examId: "exam-1",
            examTitle: "Helios Exam",
            status: "completed",
            scheduledFor: new Date("2026-06-19T09:00:00.000Z"),
            createdAt: new Date("2026-06-18T09:00:00.000Z"),
            trainingId: "training-1",
            experienceId: "experience-1",
            environmentExternalId: "env-1",
            participantId: "participant-1",
            scoreRetrievalEnabled: false,
          },
        ]),
        audit: makeAuditRepository([
          {
            id: "audit-1",
            examAttemptId: "attempt-1",
            action: "lab_launched",
            outcome: "failure",
            occurredAt: new Date("2026-06-19T09:00:00.000Z"),
            details: {
              trainingId: "training-1",
              loginUrl: "https://use.cloudshare.com/secret",
            },
            error: "Failed with sponsored-link https://use.cloudshare.com/secret",
          },
        ]),
        eventLog: makeEventLog([
          {
            eventId: "event-1",
            type: "cloudshare.exam_resume.failed",
            occurredAt: new Date("2026-06-19T09:05:00.000Z"),
            payload: {
              examAttemptId: "attempt-1",
              attemptedOperation: "resume_environment",
              integrationSurface: "cloudshare.v3.env.action.resume",
              failureMode: "http_status",
              responseStatus: 502,
              correlationId: "corr-1",
              error: "authorization token leaked",
            },
          },
        ]),
        supportLog: makeSupportLog([
          {
            timestamp: new Date("2026-06-20T10:05:00.000Z"),
            level: "warn",
            message: "cloudshare webhook rejected: unknown webhook target",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              webhookPathToken: "unknown-token",
              method: "POST",
              path: "/api/webhooks/cloudshare/unknown-token",
              requestBodyBytes: 88,
              rawBodySha256: "def456",
              signaturePresent: false,
              rawRequestBody: "{\"must\":\"not leak\"}",
            },
          },
        ]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {},
      },
    );

    expect(result.status).toBe(200);
    expect(result.body.matchingAttempts).toEqual([
      expect.objectContaining({
        id: "attempt-1",
        timeline: [
          expect.objectContaining({
            kind: "audit",
            details: {
              trainingId: "training-1",
            },
            error: "[REDACTED]",
          }),
          expect.objectContaining({
            kind: "failure",
            error: "[REDACTED]",
          }),
        ],
      }),
    ]);
    expect(result.body.diagnostics).toEqual([
      expect.objectContaining({
        webhookPathToken: "unknown-token",
        rawRequestBody: null,
      }),
    ]);
  });

  it("never returns raw webhook bodies for invalid-signature diagnostics even when the body hash is present", async () => {
    const rawRequestBody = "{\"loginUrl\":\"https://use.cloudshare.com/secret\",\"token\":\"must-not-leak\"}";

    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository([]),
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
        supportLog: makeSupportLog([
          {
            timestamp: new Date("2026-06-20T10:00:00.000Z"),
            level: "info",
            message: "cloudshare webhook received",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-helios",
              webhookPathToken: "whk-helios",
              method: "POST",
              path: "/api/webhooks/cloudshare/whk-helios",
              requestBodyBytes: rawRequestBody.length,
              rawBodySha256: "trusted-hash",
              signaturePresent: true,
              rawRequestBody,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:00:01.000Z"),
            level: "info",
            message: "cloudshare webhook signature diagnostic",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-helios",
              webhookPathToken: "whk-helios",
              rawBodySha256: "trusted-hash",
              signatureMatched: false,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:00:02.000Z"),
            level: "warn",
            message: "cloudshare webhook rejected: invalid signature",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-helios",
              webhookPathToken: "whk-helios",
              signaturePresent: true,
            },
          },
        ]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {},
      },
    );

    expect(result.body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "cloudshare webhook received",
          rawRequestBody: null,
        }),
        expect.objectContaining({
          message: "cloudshare webhook rejected: invalid signature",
          rawRequestBody: null,
        }),
      ]),
    );
  });

  it("scopes webhook diagnostics to the current Customer and never trusts legacy records without customer ownership", async () => {
    const trustedHeliosBody = "{\"Event\":\"environment.created\",\"Customer\":\"Helios\"}";
    const trustedOtherBody = "{\"Event\":\"environment.created\",\"Customer\":\"Other\"}";
    const legacyBody = "{\"Event\":\"environment.created\",\"Customer\":\"Legacy\"}";

    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository([]),
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
        supportLog: makeSupportLog([
          {
            timestamp: new Date("2026-06-20T10:00:00.000Z"),
            level: "info",
            message: "cloudshare webhook received",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-helios",
              webhookPathToken: "whk-helios",
              method: "POST",
              path: "/api/webhooks/cloudshare/whk-helios",
              requestBodyBytes: trustedHeliosBody.length,
              rawBodySha256: "hash-helios",
              signaturePresent: true,
              rawRequestBody: trustedHeliosBody,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:00:01.000Z"),
            level: "info",
            message: "cloudshare webhook signature diagnostic",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-helios",
              webhookPathToken: "whk-helios",
              rawBodySha256: "hash-helios",
              signatureMatched: true,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:01:00.000Z"),
            level: "info",
            message: "cloudshare webhook received",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-other",
              webhookPathToken: "whk-other",
              method: "POST",
              path: "/api/webhooks/cloudshare/whk-other",
              requestBodyBytes: trustedOtherBody.length,
              rawBodySha256: "hash-other",
              signaturePresent: true,
              rawRequestBody: trustedOtherBody,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:01:01.000Z"),
            level: "info",
            message: "cloudshare webhook signature diagnostic",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              customerId: "customer-other",
              webhookPathToken: "whk-other",
              rawBodySha256: "hash-other",
              signatureMatched: true,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:02:00.000Z"),
            level: "info",
            message: "cloudshare webhook received",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              webhookPathToken: "whk-legacy",
              method: "POST",
              path: "/api/webhooks/cloudshare/whk-legacy",
              requestBodyBytes: legacyBody.length,
              rawBodySha256: "hash-legacy",
              signaturePresent: true,
              rawRequestBody: legacyBody,
            },
          },
          {
            timestamp: new Date("2026-06-20T10:02:01.000Z"),
            level: "info",
            message: "cloudshare webhook signature diagnostic",
            fields: {
              operation: "receive_webhook",
              integrationSurface: "cloudshare.v3.webhook",
              webhookPathToken: "whk-legacy",
              rawBodySha256: "hash-legacy",
              signatureMatched: true,
            },
          },
        ]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {},
      },
    );

    expect(result.body.diagnostics).toHaveLength(4);
    expect(result.body.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: null,
          webhookPathToken: "whk-legacy",
          rawRequestBody: null,
        }),
        expect.objectContaining({
          customerId: "customer-helios",
          webhookPathToken: "whk-helios",
          rawRequestBody: null,
        }),
        expect.objectContaining({
          customerId: "customer-helios",
          webhookPathToken: "whk-helios",
          rawRequestBody: trustedHeliosBody,
        }),
      ]),
    );
    expect(
      result.body.diagnostics.some((diagnostic) => diagnostic.customerId === "customer-other"),
    ).toBe(false);
  });

  it("treats timezone-less scheduled date filters as UTC boundaries", async () => {
    const result = await handleGetSupportWorkbench(
      {
        attempts: makeAttemptRepository([
          {
            id: "attempt-included",
            customerId: "customer-helios",
            candidateId: "candidate-1",
            candidateEmail: "casey@helioscx.demo",
            candidateFirstName: "Casey",
            candidateLastName: "Rivera",
            examId: "exam-1",
            examTitle: "Helios Exam",
            status: "scheduled",
            scheduledFor: new Date("2026-06-20T00:30:00.000Z"),
            createdAt: new Date("2026-06-19T09:00:00.000Z"),
            trainingId: "training-1",
            experienceId: "experience-1",
            environmentExternalId: "env-1",
            participantId: "participant-1",
            scoreRetrievalEnabled: false,
          },
          {
            id: "attempt-excluded",
            customerId: "customer-helios",
            candidateId: "candidate-2",
            candidateEmail: "alex@helioscx.demo",
            candidateFirstName: "Alex",
            candidateLastName: "Chen",
            examId: "exam-1",
            examTitle: "Helios Exam",
            status: "scheduled",
            scheduledFor: new Date("2026-06-19T23:59:59.999Z"),
            createdAt: new Date("2026-06-19T08:00:00.000Z"),
            trainingId: "training-2",
            experienceId: "experience-2",
            environmentExternalId: "env-2",
            participantId: "participant-2",
            scoreRetrievalEnabled: false,
          },
        ]),
        audit: makeAuditRepository([]),
        eventLog: makeEventLog([]),
        supportLog: makeSupportLog([]),
        logger: makeLogger(),
      },
      {
        customerId: "customer-helios",
        query: {
          scheduledFrom: "2026-06-20T00:00",
        },
      },
    );

    expect(result.body.matchingAttempts).toEqual([
      expect.objectContaining({
        id: "attempt-included",
      }),
    ]);
  });
});
