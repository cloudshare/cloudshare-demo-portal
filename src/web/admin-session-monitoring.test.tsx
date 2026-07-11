/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminSessionMonitoringFeature } from "./admin-session-monitoring";

function monitoringResponse(id: string, offset: number, nextOffset: number | null) {
  return {
    monitoring: {
      summary: { scheduled: 0, ready: 0, inProgress: 1, suspended: 0, completed: 1, expired: 0, total: 2 },
      currentAttempts: { scheduled: [], ready: [], inProgress: [{ id: "live-1", candidateName: "Casey Rivera", candidateEmail: "casey@helioscx.demo", examId: "exam-1", examTitle: "Helios Foundations", status: "in_progress", scheduledFor: null, examOpenPeriodMinutes: 90, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", completedAt: null, trainingId: null, experienceId: null, environmentId: null, result: null, timeline: [] }], suspended: [] },
      history: [{ id, candidateName: `History ${id}`, candidateEmail: "history@helioscx.demo", examId: "exam-1", examTitle: "Helios Foundations", status: "completed", scheduledFor: null, examOpenPeriodMinutes: 90, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", completedAt: "2026-09-01T10:00:00.000Z", trainingId: null, experienceId: null, environmentId: null, result: null, timeline: [] }],
      historyPage: { limit: 25, offset, returned: 1, total: 2, hasMore: nextOffset !== null, nextOffset },
    },
  };
}

describe("AdminSessionMonitoringFeature", () => {
  it("loads individual monitoring at the Support route and merges the next terminal-history page", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/monitoring?historyLimit=25&historyOffset=0") return new Response(JSON.stringify(monitoringResponse("attempt-1", 0, 1)));
      if (url === "/api/admin/monitoring?historyLimit=25&historyOffset=1") return new Response(JSON.stringify(monitoringResponse("attempt-2", 1, null)));
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(<AdminSessionMonitoringFeature active fetchAdmin={fetchAdmin} />);

    await user.click(await screen.findByRole("button", { name: "Individual Exam Delivery" }));
    await screen.findByText("Casey Rivera");
    await user.click(screen.getByRole("button", { name: /Completed/ }));
    await screen.findByText("History attempt-1");
    await user.click(screen.getByRole("button", { name: "Load more history" }));

    await waitFor(() => expect(screen.getByText("History attempt-2")).toBeTruthy());
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/monitoring?historyLimit=25&historyOffset=0");
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/monitoring?historyLimit=25&historyOffset=1");
  });

  it("refreshes a focused Cohort Exam Session immediately and every 30 seconds", async () => {
    vi.useFakeTimers();
    const fetchAdmin = vi.fn(async () => new Response(JSON.stringify({ monitoring: {} })));

    render(
      <AdminSessionMonitoringFeature
        active
        fetchAdmin={fetchAdmin}
        focusedExamId="exam-1"
        focusedCohortSessionId="session-1"
        hasFocusedCohortSession
        renderFocusedCohort={() => <div>Cohort monitoring detail</div>}
      />,
    );

    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/exams/exam-1/cohort-sessions/session-1");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchAdmin).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("keeps the newest focused Cohort Exam Session detail when an older request resolves late", async () => {
    let resolveFirstSession: ((response: Response) => void) | undefined;
    let resolveSecondSession: ((response: Response) => void) | undefined;
    const fetchAdmin = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/monitoring?historyLimit=25&historyOffset=0") {
        return Promise.resolve(new Response(JSON.stringify(monitoringResponse("attempt-1", 0, null))));
      }
      if (url.endsWith("/session-1")) {
        return new Promise<Response>((resolve) => { resolveFirstSession = resolve; });
      }
      if (url.endsWith("/session-2")) {
        return new Promise<Response>((resolve) => { resolveSecondSession = resolve; });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const renderDetail = ({ detail }: { readonly detail: { readonly summary?: { readonly activeCount?: number } } | null }) => (
      <div>{detail?.summary?.activeCount ?? "Loading focused session"}</div>
    );
    const view = render(
      <AdminSessionMonitoringFeature
        active
        fetchAdmin={fetchAdmin}
        focusedExamId="exam-1"
        focusedCohortSessionId="session-1"
        hasFocusedCohortSession
        renderFocusedCohort={renderDetail}
      />,
    );

    view.rerender(
      <AdminSessionMonitoringFeature
        active
        fetchAdmin={fetchAdmin}
        focusedExamId="exam-1"
        focusedCohortSessionId="session-2"
        hasFocusedCohortSession
        renderFocusedCohort={renderDetail}
      />,
    );

    await act(async () => resolveSecondSession?.(new Response(JSON.stringify({ monitoring: { summary: { activeCount: 2 } } }))));
    await screen.findByText("2");
    await act(async () => resolveFirstSession?.(new Response(JSON.stringify({ monitoring: { summary: { activeCount: 1 } } }))));
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("lets an admin dismiss a failed monitoring refresh and retry from the unchanged branch control", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url !== "/api/admin/monitoring?historyLimit=25&historyOffset=0") throw new Error(`Unexpected request: ${url}`);
      if (fetchAdmin.mock.calls.length === 1) return new Response(JSON.stringify({ error: "Monitoring is unavailable" }), { status: 503 });
      return new Response(JSON.stringify(monitoringResponse("attempt-1", 0, null)));
    });
    const user = userEvent.setup();

    render(<AdminSessionMonitoringFeature active fetchAdmin={fetchAdmin} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Monitoring is unavailable");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Individual Exam Delivery" }));
    await user.click(screen.getByRole("button", { name: "Refresh Monitoring" }));
    expect(await screen.findByText("Casey Rivera")).toBeTruthy();
  });

  it("lets an admin dismiss a failed focused Cohort Exam Session refresh", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/monitoring?historyLimit=25&historyOffset=0") {
        return new Response(JSON.stringify(monitoringResponse("attempt-1", 0, null)));
      }
      if (url === "/api/admin/exams/exam-1/cohort-sessions/session-1") {
        return new Response(JSON.stringify({ error: "Cohort detail is unavailable" }), { status: 503 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();

    render(
      <AdminSessionMonitoringFeature
        active
        fetchAdmin={fetchAdmin}
        focusedExamId="exam-1"
        focusedCohortSessionId="session-1"
        hasFocusedCohortSession
        renderFocusedCohort={() => <div>Cohort monitoring detail</div>}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain("Cohort detail is unavailable");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
