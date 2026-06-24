import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMonitoringFilters,
  buildMonitoringHistoryAttemptKey,
  SessionMonitoringPanel,
} from "./session-monitoring-panel";
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
        id: "diag-1",
        kind: "diagnostic",
        occurredAt: "2026-06-21T09:10:00.000Z",
        level: "info",
        source: "runtime",
        operation: "exam_attempt.score.retrieve",
        outcome: "success",
        message: "Score retrieved successfully",
        details: {
          scoreAvailable: true,
          percentComplete: 90,
          stepsCompleted: 9,
          stepsTotal: 10,
        },
      },
      {
        id: "diag-2",
        kind: "diagnostic",
        occurredAt: "2026-06-21T09:05:00.000Z",
        level: "warn",
        source: "runtime",
        operation: "exam_attempt.resume",
        outcome: "failure",
        message: "resume failed",
        correlationId: "corr-1",
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the monitoring status strip, separated live and history sections, and the Support Diagnostics handoff", () => {
    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView(),
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("Monitoring status");
    expect(html).toContain("Candidate email");
    expect(html).toContain("Exam ID or ExamAttempt ID");
    expect(html).toContain("Clear filters");
    expect(html).toContain("Session Monitoring is the current-state operations surface for active ExamAttempts.");
    expect(html).toContain("Use Support Diagnostics for the forensic trace of what happened and in what order.");
    expect(html).toContain("Live queues");
    expect(html).toContain("Completed / expired history (showing 1 of 3)");
    expect(html).toContain("Load more history");
    expect(html).toContain("Open in Support Diagnostics");
    expect(html).toContain("Investigation opens Support Diagnostics filtered to this ExamAttempt ID.");
    expect(html).not.toContain("No timeline entries recorded.");
    expect(html).not.toContain("<table");
  });

  it("hardens the attempt summary identity text so long values can wrap without crowding the status badge", () => {
    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView({
          history: [
            makeAttempt({
              candidateName:
                "Casey Rivera With A Very Long Candidate Name That Should Wrap On Narrow Screens",
              examTitle: "Helios CX Analyst Certification Experience With A Very Long Title",
            }),
          ],
        }),
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("Very Long Candidate Name");
    expect(html).toContain("Very Long Title");
  });

  it("keeps status badges off current queue cards while retaining them in bounded history", () => {
    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView({
          currentAttempts: {
            scheduled: [
              makeAttempt({
                status: "scheduled",
                candidateName: "Scheduled Candidate",
                examTitle: "Scheduled Exam",
              }),
            ],
            ready: [],
            inProgress: [],
            suspended: [
              makeAttempt({
                status: "suspended",
                candidateName: "Suspended Candidate",
                examTitle: "Suspended Exam",
              }),
            ],
          },
          history: [
            makeAttempt({
              status: "suspended",
              candidateName: "History Candidate",
              examTitle: "History Exam",
            }),
          ],
        }),
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html.match(/>suspended</g)?.length).toBe(1);
  });

  it("leads attempt summaries with a bold candidate line and a normal exam line", () => {
    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView({
          currentAttempts: {
            scheduled: [
              makeAttempt({
                candidateName: "Scheduled Candidate",
                candidateEmail: "scheduled.candidate@helioscx.demo",
                examTitle: "Scheduled Exam",
                status: "scheduled",
              }),
            ],
            ready: [],
            inProgress: [],
            suspended: [],
          },
          history: [
            makeAttempt({
              candidateName: "History Candidate",
              candidateEmail: "history.candidate@helioscx.demo",
              examTitle: "History Exam",
              status: "completed",
            }),
          ],
        }),
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("<strong style=\"color:#111827;font-weight:700\">Scheduled Candidate (scheduled.candidate@helioscx.demo)</strong>");
    expect(html).toContain("<span style=\"color:#4b5563;font-weight:400\">Scheduled Exam");
    expect(html).toContain("<strong style=\"color:#111827;font-weight:700\">History Candidate (history.candidate@helioscx.demo)</strong>");
    expect(html).toContain("<span style=\"color:#4b5563;font-weight:400\">History Exam");
  });

  it("filters the monitoring view by status, candidate email, and exam or ExamAttempt lookup without changing summary counts", () => {
    const filtered = applyMonitoringFilters(
      makeMonitoringView({
        summary: {
          scheduled: 4,
          ready: 3,
          inProgress: 2,
          suspended: 1,
          completed: 5,
          expired: 2,
        },
        currentAttempts: {
          scheduled: [
            makeAttempt({
              id: "attempt-scheduled",
              status: "scheduled",
              examId: "exam-alpha",
              candidateEmail: "alex@helioscx.demo",
            }),
          ],
          ready: [
            makeAttempt({
              id: "attempt-ready",
              status: "ready",
              examId: "exam-beta",
              candidateEmail: "blair@helioscx.demo",
            }),
          ],
          inProgress: [],
          suspended: [],
        },
        history: [
          makeAttempt({
            id: "attempt-completed",
            status: "completed",
            examId: "exam-alpha",
            candidateEmail: "alex@helioscx.demo",
          }),
          makeAttempt({
            id: "attempt-expired",
            status: "expired",
            examId: "exam-gamma",
            candidateEmail: "casey@helioscx.demo",
          }),
        ],
      }),
      {
        status: "completed",
        candidateEmail: " ALEX@helioscx.demo ",
        identifier: " exam-alpha ",
      },
    );

    expect(filtered.summary).toEqual({
      scheduled: 4,
      ready: 3,
      inProgress: 2,
      suspended: 1,
      completed: 5,
      expired: 2,
    });
    expect(filtered.currentAttempts.scheduled).toEqual([]);
    expect(filtered.currentAttempts.ready).toEqual([]);
    expect(filtered.history.map((attempt) => attempt.id)).toEqual(["attempt-completed"]);

    const byAttemptId = applyMonitoringFilters(filtered, {
      status: "completed",
      candidateEmail: "alex@helioscx.demo",
      identifier: "attempt-completed",
    });

    expect(byAttemptId.history.map((attempt) => attempt.id)).toEqual(["attempt-completed"]);
  });

  it("shows the selected monitoring status filter and explains when no attempts match it", () => {
    vi.spyOn(React, "useState").mockReturnValueOnce([
      {
        status: "expired",
        candidateEmail: "nobody@helioscx.demo",
        identifier: "",
      },
      () => undefined,
    ]);

    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView({
          currentAttempts: {
            scheduled: [],
            ready: [],
            inProgress: [],
            suspended: [],
          },
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
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("aria-pressed=\"true\"");
    const selectedStatusMetricButton = html.match(/<button type="button" aria-pressed="true" style="[^"]+"/)?.[0];

    expect(selectedStatusMetricButton).toContain("border-width:1px");
    expect(selectedStatusMetricButton).toContain("border-style:solid");
    expect(selectedStatusMetricButton).toContain("border-color:#1d4ed8");
    expect(selectedStatusMetricButton).not.toContain("border:1px solid");
    expect(html).toContain("2 monitoring filters active.");
    expect(html).toContain("No attempts match the current monitoring filters.");
  });

  it("keeps the history empty state scoped when a filtered live queue still has matches", () => {
    vi.spyOn(React, "useState").mockReturnValueOnce([
      {
        status: null,
        candidateEmail: "",
        identifier: "742ffd2b-55e4-437b-8276-9574eefe58a0",
      },
      () => undefined,
    ]);

    const html = renderToStaticMarkup(
      createElement(SessionMonitoringPanel, {
        monitoring: makeMonitoringView({
          currentAttempts: {
            scheduled: [],
            ready: [
              makeAttempt({
                id: "742ffd2b-55e4-437b-8276-9574eefe58a0",
                status: "ready",
                examTitle: "Windows Boxes",
                candidateName: "Live Candidate",
                candidateEmail: "live.candidate@helioscx.demo",
              }),
            ],
            inProgress: [],
            suspended: [],
          },
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
        loading: false,
        onRefresh: () => {},
        onLoadMoreHistory: () => {},
        onOpenSupportDiagnostics: () => {},
      }),
    );

    expect(html).toContain("Windows Boxes");
    expect(html).toContain("No completed or expired attempts match the current monitoring filters.");
    expect(html).not.toContain("No attempts match the current monitoring filters.");
  });
});

describe("monitoring row keys", () => {
  it("builds stable keys for terminal-history rows", () => {
    const attempt = makeAttempt();

    expect(buildMonitoringHistoryAttemptKey(attempt)).toBe("attempt-1");
  });
});
