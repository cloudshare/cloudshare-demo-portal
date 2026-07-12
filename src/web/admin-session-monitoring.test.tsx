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

    await screen.findByText("Casey Rivera");
    await user.click(screen.getByRole("button", { name: /Completed/ }));
    await screen.findByText("History attempt-1");
    await user.click(screen.getByRole("button", { name: "Load more history" }));

    await waitFor(() => expect(screen.getByText("History attempt-2")).toBeTruthy());
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/monitoring?historyLimit=25&historyOffset=0");
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/monitoring?historyLimit=25&historyOffset=1");
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
    await user.click(screen.getByRole("button", { name: "Refresh Monitoring" }));
    expect(await screen.findByText("Casey Rivera")).toBeTruthy();
  });

});
