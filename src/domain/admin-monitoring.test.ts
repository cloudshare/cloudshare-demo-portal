import { describe, expect, it } from "vitest";
import {
  buildAdminMonitoringView,
  type AdminMonitoringSummary,
  type MonitoringAttemptPage,
  type MonitoringAttemptRecord,
} from "./admin-monitoring";
import type { AuditRecord } from "./audit-trail";
import type { EventLogRecord } from "./event-log";

function makeAttempt(
  partial: Partial<MonitoringAttemptRecord> = {},
): MonitoringAttemptRecord {
  return {
    id: "attempt-1",
    customerId: "customer-1",
    candidateId: "candidate-1",
    candidateEmail: "candidate.one@helioscx.demo",
    candidateFirstName: "Casey",
    candidateLastName: "Rivera",
    examId: "exam-1",
    examTitle: "Helios CX Fundamentals",
    status: "scheduled",
    scheduledFor: new Date("2026-06-19T09:00:00.000Z"),
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    trainingId: "training-1",
    experienceId: "experience-1",
    environmentExternalId: "env-1",
    participantId: "participant-1",
    scoreRetrievalEnabled: false,
    ...partial,
  };
}

function makeAudit(partial: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "audit-1",
    examAttemptId: "attempt-1",
    action: "lab_launched",
    outcome: "success",
    occurredAt: new Date("2026-06-19T09:00:00.000Z"),
    ...partial,
  };
}

function makeEvent(partial: Partial<EventLogRecord> = {}): EventLogRecord {
  return {
    eventId: "event-1",
    type: "cloudshare.exam_suspend.failed",
    occurredAt: new Date("2026-06-19T09:10:00.000Z"),
    payload: {
      examAttemptId: "attempt-1",
      attemptedOperation: "suspend_environment",
      integrationSurface: "cloudshare.v3.env.action.suspend",
      failureMode: "http_status",
      responseStatus: 502,
      correlationId: "corr-1",
    },
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

function makeHistoryPage(
  attempts: readonly MonitoringAttemptRecord[],
  partial: Partial<MonitoringAttemptPage> = {},
): MonitoringAttemptPage {
  return {
    attempts,
    total: attempts.length,
    limit: 25,
    offset: 0,
    ...partial,
  };
}

describe("buildAdminMonitoringView", () => {
  it("uses the supplied terminal-history page while preserving full monitoring summary counts", () => {
    const view = buildAdminMonitoringView({
      summary: makeSummary({
        scheduled: 1,
        completed: 2,
        expired: 1,
      }),
      currentAttempts: [
        makeAttempt({
          id: "attempt-scheduled",
          status: "scheduled",
          scheduledFor: new Date("2026-06-22T09:00:00.000Z"),
          createdAt: new Date("2026-06-21T09:00:00.000Z"),
        }),
      ],
      history: makeHistoryPage(
        [
          makeAttempt({
            id: "attempt-completed-3",
            status: "completed",
            scheduledFor: new Date("2026-06-21T12:00:00.000Z"),
            createdAt: new Date("2026-06-20T12:00:00.000Z"),
          }),
          makeAttempt({
            id: "attempt-expired-2",
            status: "expired",
            scheduledFor: new Date("2026-06-21T11:00:00.000Z"),
            createdAt: new Date("2026-06-20T11:00:00.000Z"),
          }),
        ],
        {
          total: 3,
          limit: 2,
          offset: 1,
        },
      ),
      auditRecords: [],
      eventLog: [],
    });

    expect(view.summary).toEqual({
      scheduled: 1,
      ready: 0,
      inProgress: 0,
      suspended: 0,
      completed: 2,
      expired: 1,
    });
    expect(view.currentAttempts.scheduled).toHaveLength(1);
    expect(view.history.map((attempt) => attempt.id)).toEqual([
      "attempt-completed-3",
      "attempt-expired-2",
    ]);
    expect(view.historyPage).toEqual({
      limit: 2,
      offset: 1,
      returned: 2,
      total: 3,
      hasMore: false,
      nextOffset: null,
    });
  });

  it("groups current attempts by active state and puts completed attempts into history with a timeline", () => {
    const view = buildAdminMonitoringView({
      summary: makeSummary({
        scheduled: 1,
        inProgress: 1,
        completed: 1,
      }),
      currentAttempts: [
        makeAttempt(),
        makeAttempt({
          id: "attempt-2",
          candidateId: "candidate-2",
          candidateEmail: "candidate.two@helioscx.demo",
          candidateFirstName: "Morgan",
          candidateLastName: "Lee",
          status: "in_progress",
          scheduledFor: new Date("2026-06-19T10:00:00.000Z"),
          createdAt: new Date("2026-06-18T10:00:00.000Z"),
        }),
      ],
      history: makeHistoryPage([
        makeAttempt({
          id: "attempt-3",
          candidateId: "candidate-3",
          candidateEmail: "candidate.three@helioscx.demo",
          candidateFirstName: "Jordan",
          candidateLastName: "Park",
          status: "completed",
          scheduledFor: new Date("2026-06-17T09:00:00.000Z"),
          createdAt: new Date("2026-06-16T09:00:00.000Z"),
          scoreRetrievalEnabled: true,
        }),
      ]),
      auditRecords: [
        makeAudit(),
        makeAudit({
          id: "audit-2",
          examAttemptId: "attempt-3",
          action: "lab_resumed",
          outcome: "success",
          occurredAt: new Date("2026-06-17T09:15:00.000Z"),
        }),
        makeAudit({
          id: "audit-3",
          examAttemptId: "attempt-3",
          action: "score_retrieved",
          outcome: "success",
          occurredAt: new Date("2026-06-17T10:05:00.000Z"),
          details: {
            percentComplete: 75,
            stepsCompleted: 3,
            stepsTotal: 4,
            scoreAvailable: true,
            loginUrl: "https://use.cloudshare.com/secret",
          },
        }),
      ],
      eventLog: [
        makeEvent({
          eventId: "event-2",
          occurredAt: new Date("2026-06-17T09:20:00.000Z"),
          payload: {
            examAttemptId: "attempt-3",
            attemptedOperation: "resume_environment",
            integrationSurface: "cloudshare.v3.env.action.resume",
            failureMode: "transport",
            correlationId: "corr-2",
            requestHeaders: { authorization: "Bearer secret" },
            responseBody: "{\"loginUrl\":\"https://use.cloudshare.com/secret\"}",
          },
        }),
      ],
    });

    expect(view.summary).toEqual({
      scheduled: 1,
      ready: 0,
      inProgress: 1,
      suspended: 0,
      completed: 1,
      expired: 0,
    });
    expect(view.currentAttempts.scheduled).toHaveLength(1);
    expect(view.currentAttempts.inProgress).toHaveLength(1);
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({
      id: "attempt-3",
      candidateName: "Jordan Park",
      result: {
        status: "completed",
        scoreAvailable: true,
        percentComplete: 75,
        stepsCompleted: 3,
        stepsTotal: 4,
      },
    });
    expect(view.history[0].timeline).toEqual([
      expect.objectContaining({
        kind: "audit",
        action: "lab_resumed",
      }),
      expect.objectContaining({
        kind: "failure",
        eventType: "cloudshare.exam_suspend.failed",
        integrationSurface: "cloudshare.v3.env.action.resume",
        failureMode: "transport",
      }),
      expect.objectContaining({
        kind: "audit",
        action: "score_retrieved",
        details: {
          percentComplete: 75,
          stepsCompleted: 3,
          stepsTotal: 4,
          scoreAvailable: true,
        },
      }),
    ]);
  });

  it("ignores unrelated event log entries and falls back to status-only results when no score audit exists", () => {
    const view = buildAdminMonitoringView({
      summary: makeSummary({
        expired: 1,
      }),
      currentAttempts: [],
      history: makeHistoryPage([
        makeAttempt({
          id: "attempt-expired",
          status: "expired",
          candidateFirstName: null,
          candidateLastName: null,
          candidateEmail: "expired@helioscx.demo",
        }),
      ]),
      auditRecords: [],
      eventLog: [
        makeEvent({
          eventId: "event-unrelated",
          payload: {
            examAttemptId: "different-attempt",
            attemptedOperation: "suspend_environment",
            integrationSurface: "cloudshare.v3.env.action.suspend",
            failureMode: "transport",
          },
        }),
        makeEvent({
          eventId: "event-nonfailure",
          type: "exam_attempt.created",
          payload: { examAttemptId: "attempt-expired" },
        }),
      ],
    });

    expect(view.history).toEqual([
      expect.objectContaining({
        id: "attempt-expired",
        candidateName: "expired@helioscx.demo",
        result: {
          status: "expired",
          scoreAvailable: false,
        },
        timeline: [],
      }),
    ]);
  });

  it("redacts sensitive audit and event details from monitoring timelines", () => {
    const view = buildAdminMonitoringView({
      summary: makeSummary({
        completed: 1,
      }),
      currentAttempts: [],
      history: makeHistoryPage([makeAttempt({ status: "completed" })]),
      auditRecords: [
        makeAudit({
          action: "lab_launched",
          details: {
            trainingId: "training-1",
            experienceId: "experience-1",
            loginUrl: "https://use.cloudshare.com/secret",
            apiKey: "super-secret",
            token: "abcd1234",
            requestBody: { loginUrl: "https://use.cloudshare.com/secret" },
          },
          error: "Failed with sponsored-link https://use.cloudshare.com/secret",
        }),
      ],
      eventLog: [
        makeEvent({
          payload: {
            examAttemptId: "attempt-1",
            attemptedOperation: "create_sponsored_link",
            integrationSurface: "cloudshare.v4.training.sponsored_link",
            failureMode: "http_status",
            responseStatus: 502,
            correlationId: "corr-1",
            requestHeaders: { authorization: "cs_sha1 secret" },
            requestBody: { apiKey: "abc", loginUrl: "https://use.cloudshare.com/secret" },
            responseBody: "{\"token\":\"secret\"}",
            error: "request failed with api key secret",
          },
        }),
      ],
    });

    expect(view.history[0]?.timeline).toEqual([
      expect.objectContaining({
        kind: "audit",
        details: {
          trainingId: "training-1",
          experienceId: "experience-1",
        },
        error: "[REDACTED]",
      }),
      expect.objectContaining({
        kind: "failure",
        eventType: "cloudshare.exam_suspend.failed",
        attemptedOperation: "create_sponsored_link",
        integrationSurface: "cloudshare.v4.training.sponsored_link",
        failureMode: "http_status",
        responseStatus: 502,
        correlationId: "corr-1",
        error: "[REDACTED]",
      }),
    ]);
  });
});
