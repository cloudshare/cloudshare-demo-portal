import { describe, expect, it } from "vitest";
import {
  buildAdminMonitoringView,
  type AdminMonitoringSummary,
  type MonitoringAttemptPage,
  type MonitoringAttemptRecord,
} from "./admin-monitoring";
import type { DiagnosticLogEntry } from "./diagnostic-log";

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
    examOpenPeriodMinutes: 120,
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

function makeDiagnostic(
  partial: Partial<DiagnosticLogEntry> = {},
): DiagnosticLogEntry {
  return {
    id: "diag-1",
    occurredAt: new Date("2026-06-19T09:00:00.000Z"),
    level: "info",
    source: "runtime",
    operation: "exam_attempt.schedule",
    outcome: "success",
    customerId: "customer-1",
    actor: null,
    subject: { type: "exam_attempt", id: "attempt-1" },
    message: "ExamAttempt scheduled",
    correlationId: "corr-1",
    candidateEmail: "candidate.one@helioscx.demo",
    examId: "exam-1",
    examAttemptId: "attempt-1",
    externalIds: null,
    request: null,
    response: null,
    details: null,
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
      now: new Date("2026-06-18T00:00:00.000Z"),
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
      diagnosticRecords: [],
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

  it("presents active attempts whose authored open period has closed as terminal monitoring state", () => {
    const view = buildAdminMonitoringView({
      now: new Date("2026-06-19T11:00:00.000Z"),
      summary: makeSummary({
        ready: 1,
        suspended: 1,
      }),
      currentAttempts: [
        makeAttempt({
          id: "attempt-ready-closed",
          status: "ready",
          scheduledFor: new Date("2026-06-19T09:00:00.000Z"),
          examOpenPeriodMinutes: 60,
        }),
        makeAttempt({
          id: "attempt-suspended-closed",
          status: "suspended",
          scheduledFor: new Date("2026-06-19T09:00:00.000Z"),
          examOpenPeriodMinutes: 60,
        }),
      ],
      history: makeHistoryPage([]),
      diagnosticRecords: [],
    });

    expect(view.summary).toEqual({
      scheduled: 0,
      ready: 0,
      inProgress: 0,
      suspended: 0,
      completed: 1,
      expired: 1,
    });
    expect(view.currentAttempts.ready).toEqual([]);
    expect(view.currentAttempts.suspended).toEqual([]);
    expect(view.history.map((attempt) => [attempt.id, attempt.status])).toEqual([
      ["attempt-ready-closed", "expired"],
      ["attempt-suspended-closed", "completed"],
    ]);
  });

  it("groups current attempts by active state and puts completed attempts into history with a timeline", () => {
    const view = buildAdminMonitoringView({
      now: new Date("2026-06-18T00:00:00.000Z"),
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
      diagnosticRecords: [
        makeDiagnostic(),
        makeDiagnostic({
          id: "diag-2",
          examAttemptId: "attempt-3",
          operation: "exam_attempt.resume",
          outcome: "success",
          occurredAt: new Date("2026-06-17T09:15:00.000Z"),
          message: "Exam resumed",
        }),
        makeDiagnostic({
          id: "diag-3",
          examAttemptId: "attempt-3",
          operation: "exam_attempt.score.retrieve",
          outcome: "success",
          occurredAt: new Date("2026-06-17T10:05:00.000Z"),
          message: "Score retrieved successfully",
          response: {
            percentComplete: 75,
            stepsCompleted: 3,
            stepsTotal: 4,
            scoreAvailable: true,
            loginUrl: "https://use.cloudshare.com/secret",
          },
        }),
        makeDiagnostic({
          id: "diag-4",
          occurredAt: new Date("2026-06-17T09:20:00.000Z"),
          examAttemptId: "attempt-3",
          level: "warn",
          source: "runtime",
          operation: "exam_attempt.resume",
          outcome: "failure",
          message: "Exam resume failed",
          correlationId: "corr-2",
          details: {
            attemptedOperation: "resume_environment",
            integrationSurface: "cloudshare.v3.env.action.resume",
            failureMode: "transport",
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
        kind: "diagnostic",
        operation: "exam_attempt.resume",
        outcome: "success",
      }),
      expect.objectContaining({
        kind: "diagnostic",
        operation: "exam_attempt.resume",
        outcome: "failure",
        correlationId: "corr-2",
      }),
      expect.objectContaining({
        kind: "diagnostic",
        operation: "exam_attempt.score.retrieve",
        outcome: "success",
      }),
    ]);
  });

  it("ignores unrelated diagnostics and falls back to status-only results when no score retrieval exists", () => {
    const view = buildAdminMonitoringView({
      now: new Date("2026-06-18T00:00:00.000Z"),
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
      diagnosticRecords: [
        makeDiagnostic({
          id: "diag-unrelated",
          examAttemptId: "different-attempt",
          operation: "exam_attempt.resume",
        }),
        makeDiagnostic({
          id: "diag-no-score",
          examAttemptId: "attempt-expired",
          operation: "exam_attempt.enter",
          message: "Candidate entered exam - redirecting to CloudShare",
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
        timeline: [
          expect.objectContaining({
            id: "diag-no-score",
            operation: "exam_attempt.enter",
            outcome: "success",
          }),
        ],
      }),
    ]);
  });

  it("redacts sensitive diagnostic details from monitoring timelines", () => {
    const view = buildAdminMonitoringView({
      now: new Date("2026-06-18T00:00:00.000Z"),
      summary: makeSummary({
        completed: 1,
      }),
      currentAttempts: [],
      history: makeHistoryPage([makeAttempt({ status: "completed" })]),
      diagnosticRecords: [
        makeDiagnostic({
          operation: "cloudshare.create_sponsored_link",
          message: "Failed with sponsored-link https://use.cloudshare.com/secret",
          details: {
            trainingId: "training-1",
            experienceId: "experience-1",
            loginUrl: "https://use.cloudshare.com/secret",
            apiKey: "super-secret",
            token: "abcd1234",
            requestBody: { loginUrl: "https://use.cloudshare.com/secret" },
          },
        }),
        makeDiagnostic({
          id: "diag-2",
          level: "warn",
          operation: "exam_attempt.resume",
          outcome: "failure",
          message: "request failed with api key secret",
          details: {
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
        kind: "diagnostic",
        details: {
          trainingId: "training-1",
          experienceId: "experience-1",
        },
        message: "[REDACTED]",
      }),
      expect.objectContaining({
        kind: "diagnostic",
        operation: "exam_attempt.resume",
        correlationId: "corr-1",
        message: "[REDACTED]",
      }),
    ]);
  });
});
