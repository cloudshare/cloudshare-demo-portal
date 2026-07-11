import { describe, expect, it } from "vitest";
import type { AdminMonitoringView } from "@/domain/admin-monitoring";
import {
  buildMonitoringHistoryQueryString,
  mergeMonitoringHistoryPage,
} from "./admin-session-monitoring-state";

function monitoringView(history: AdminMonitoringView["history"], offset: number): AdminMonitoringView {
  return {
    summary: { scheduled: 0, ready: 0, inProgress: 0, suspended: 0, completed: 2, expired: 1 },
    currentAttempts: { scheduled: [], ready: [], inProgress: [], suspended: [] },
    history,
    historyPage: { limit: 25, offset, returned: history.length, total: 2, hasMore: offset === 0, nextOffset: offset === 0 ? 1 : null },
  };
}

function historyAttempt(id: string): AdminMonitoringView["history"][number] {
  return {
    id,
    examId: `exam-${id}`,
    examTitle: "Helios Foundations",
    candidateId: `candidate-${id}`,
    candidateName: `Candidate ${id}`,
    candidateEmail: `${id}@helioscx.demo`,
    examOpenPeriodMinutes: 90,
    status: "completed",
    scheduledFor: "2026-06-21T12:00:00.000Z",
    createdAt: "2026-06-20T12:00:00.000Z",
    trainingId: null,
    experienceId: null,
    environmentExternalId: null,
    participantId: null,
    scoreRetrievalEnabled: false,
    timeline: [],
  };
}

describe("Session Monitoring history state", () => {
  it("serialises bounded terminal-history paging parameters for the monitoring API", () => {
    expect(buildMonitoringHistoryQueryString({ limit: 25, offset: 50 })).toBe(
      "?historyLimit=25&historyOffset=50",
    );
  });

  it("merges the next completed and expired history page without duplicating attempts", () => {
    const merged = mergeMonitoringHistoryPage(
      monitoringView([historyAttempt("attempt-3")], 0),
      monitoringView([historyAttempt("attempt-3"), historyAttempt("attempt-2")], 1),
    );

    expect(merged.history.map((attempt) => attempt.id)).toEqual(["attempt-3", "attempt-2"]);
    expect(merged.historyPage.offset).toBe(1);
  });
});
