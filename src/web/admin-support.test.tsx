/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { AdminSupportFeature } from "./admin-support";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AdminSupportFeature", () => {
  it("loads central Support Diagnostics using the existing route filters and lets an admin refresh the same evidence", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(
      json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }),
    );

    render(
      <AdminSupportFeature
        active
        view="diagnostics"
        diagnosticFilters={{ correlationId: "corr-42" }}
        fetchAdmin={fetchAdmin}
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByText((_, element) => element?.textContent === "Filtered to correlation ID corr-42.")).toBeTruthy();
    expect(fetchAdmin).toHaveBeenCalledWith(
      "/api/admin/diagnostics?correlationId=corr-42&limit=50&offset=0",
    );

    await user.click(screen.getByRole("button", { name: "Refresh Page" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledTimes(2));
    expect(fetchAdmin).toHaveBeenLastCalledWith(
      "/api/admin/diagnostics?correlationId=corr-42&limit=50&offset=0",
    );
  });

  it("keeps Audit Trail filtering and refresh inside central Support using the existing API contract", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ records: [] }));

    render(
      <AdminSupportFeature
        active
        view="audit"
        diagnosticFilters={{}}
        fetchAdmin={fetchAdmin}
        onNavigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/audit"));
    await user.type(screen.getByPlaceholderText("Exam attempt ID"), "attempt-42");
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));

    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/admin/audit?examAttemptId=attempt-42"));
    expect(screen.getByText("No records found")).toBeTruthy();
  });

  it("uses the shell-owned typed Support route when an investigation filter changes", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(
      json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }),
    );

    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} fetchAdmin={fetchAdmin} onNavigate={onNavigate} />);
    await screen.findByRole("button", { name: "Apply Filters" });
    await user.type(screen.getByPlaceholderText("corr-123"), "corr-99");
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));

    expect(onNavigate).toHaveBeenCalledWith({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: { correlationId: "corr-99" },
    });
  });
});
