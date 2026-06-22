import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildMonitoringHistoryAttemptKey, SessionMonitoringPanel } from "./session-monitoring-panel";
import type { AdminMonitoringView, MonitoringAttemptView } from "@/domain/admin-monitoring";

function makeAttempt(partial: Partial<MonitoringAttemptView> = {}): MonitoringAttemptView {
  return {
    id: "attempt-1",
    examId: "exam-1",
    examTitle: "Helios CX Analyst",
    candidateId: "candidate-1",
    candidateName: "Casey Rivera",
    candidateEmail: "candidate@helioscx.demo",
    status: "completed",
    scheduledFor: "2026-06-21T09:00:00.000Z",
    createdAt: "2026-06-20T09:00:00.000Z",
    trainingId: "training-1",
    experienceId: "experience-1",
    environmentExternalId: "env-1",
    participantId: "participant-1",
    scoreRetrievalEnabled: true,
    timeline: [
      {
        id: "audit-1",
        kind: "audit",
        occurredAt: "2026-06-21T09:10:00.000Z",
        action: "score_retrieved",
        outcome: "success",
        details: {
          scoreAvailable: true,
          percentComplete: 90,
          stepsCompleted: 9,
          stepsTotal: 10,
        },
      },
      {
        id: "event-1",
        kind: "failure",
        occurredAt: "2026-06-21T09:05:00.000Z",
        eventType: "cloudshare.exam_resume.failed",
        attemptedOperation: "resume_environment",
        integrationSurface: "cloudshare.v4.environment",
        method: "POST",
        path: "/v4/env/resume",
        failureMode: "http_status",
        responseStatus: 502,
        correlationId: "corr-1",
        error: "resume failed",
      },
    ],
    result: {
      status: "completed",
      scoreAvailable: true,
      percentComplete: 90,
      stepsCompleted: 9,
      stepsTotal: 10,
    },
    ...partial,
  };
}

function makeMonitoringView(partial: Partial<AdminMonitoringView> = {}): AdminMonitoringView {
  return {
    summary: {
      scheduled: 1,
      ready: 1,
      inProgress: 1,
      suspended: 1,
      completed: 2,
      expired: 1,
    },
    currentAttempts: {
      scheduled: [],
      ready: [],
      inProgress: [],
      suspended: [],
    },
    history: [makeAttempt()],
    historyPage: {
      limit: 25,
      offset: 0,
      returned: 1,
      total: 3,
      hasMore: true,
      nextOffset: 1,
    },
    ...partial,
  };
}

describe("SessionMonitoringPanel", () => {
  it("renders current-state monitoring copy, bounded terminal-history copy, and the Support Diagnostics handoff", () => {
    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView(),
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("Session Monitoring is the current-state operations surface for active ExamAttempts.");
    expect(html).toContain("Use Support Diagnostics for the forensic trace of what happened and in what order.");
    expect(html).toContain("Completed / expired history (showing 1 of 3)");
    expect(html).toContain("Load more history");
    expect(html).toContain("Open in Support Diagnostics");
    expect(html).toContain("Durable history lives in Support Diagnostics.");
    expect(html).not.toContain("No timeline entries recorded.");
    expect(html).not.toContain("<table");
  });
});

describe("monitoring row keys", () => {
  it("builds stable keys for terminal-history rows", () => {
    const attempt = makeAttempt();

    expect(buildMonitoringHistoryAttemptKey(attempt)).toBe("attempt-1");
  });
});
