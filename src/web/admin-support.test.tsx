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
  it("reloads page zero when applying unchanged deep-linked Support Diagnostics filters", async () => {
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

    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledTimes(2));
    expect(fetchAdmin).toHaveBeenLastCalledWith(
      "/api/admin/diagnostics?correlationId=corr-42&limit=50&offset=0",
    );
  });

  it("resets Diagnostics pagination to page zero when applying filters", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>()
      .mockResolvedValueOnce(json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: true, nextOffset: 50 } }))
      .mockResolvedValueOnce(json({ entries: [], page: { limit: 50, offset: 50, returned: 0, hasMore: false, nextOffset: null } }))
      .mockResolvedValueOnce(json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: true, nextOffset: 50 } }));

    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    await screen.findByRole("button", { name: "Next" });
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/admin/diagnostics?limit=50&offset=50"));
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/admin/diagnostics?limit=50&offset=0"));
  });

  it("keeps Support request failures in the existing dismissible danger-banner presentation", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ error: "Diagnostics unavailable" }, 503));
    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Diagnostics unavailable");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a local Support error when the admin navigates away from Support", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ error: "Diagnostics unavailable" }, 503));
    const { rerender } = render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);

    await screen.findByRole("alert");
    rerender(<AdminSupportFeature active={false} view="diagnostics" diagnosticFilters={{}} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("keeps a locked Sales source in every diagnostics request when filters are applied or cleared", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockImplementation(async () =>
      json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }),
    );

    render(
      <AdminSupportFeature
        active
        view="diagnostics"
        diagnosticFilters={{}}
        lockedDiagnosticFilters={{ source: "sales-records" }}
        fetchAdmin={fetchAdmin}
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByText("This view is limited to local Sales record diagnostics.")).toBeTruthy();
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/diagnostics?source=sales-records&limit=50&offset=0");
    expect(screen.queryByLabelText("Source")).toBeNull();

    await user.type(screen.getByPlaceholderText("corr-123"), "corr-sales");
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/admin/diagnostics?source=sales-records&correlationId=corr-sales&limit=50&offset=0"));

    await user.click(screen.getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/admin/diagnostics?source=sales-records&limit=50&offset=0"));
  });
});
