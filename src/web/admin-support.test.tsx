/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { AdminSupportFeature } from "./admin-support";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AdminSupportFeature", () => {
  it("renders exact Session and Trial Operation labels returned by protected Sales Support", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({
      entries: [
        { id: "session", occurredAt: "2026-09-11T10:00:00.000Z", level: "info", source: "sales-demo-sessions", operation: "cloudshare.request", outcome: "success", customerId: "customer-certalis", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" }, message: "Session exchange", correlationId: "corr-session", details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3" } },
        { id: "trial", occurredAt: "2026-09-11T10:01:00.000Z", level: "info", source: "sales-trial-enrollment", operation: "sales_trial.cloudshare.request", outcome: "success", customerId: "customer-certalis", actor: { type: "admin" }, subject: { type: "sales_trial_enrollment", id: "trial-1" }, message: "Trial exchange", correlationId: "corr-trial", details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3.projects" } },
      ], page: { limit: 50, offset: 0, returned: 2, hasMore: false, nextOffset: null },
    }));
    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    expect(await screen.findByText("cloudshare.v3.projects")).toBeTruthy();
    expect(screen.getByText("cloudshare.v3")).toBeTruthy();
    expect(screen.queryByText("sales_trial.cloudshare.request")).toBeNull();
    expect(fetchAdmin).toHaveBeenCalledWith("/api/sales/diagnostics?limit=50&offset=0");
  });

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

  it("G: Support preserves filter reset pagination navigation while warning on bounded incomplete results", async () => {
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

  it("G: renders a bounded-incomplete warning without an unreachable continuation and disables Next", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ entries: [], page: { limit: 50, offset: 5000, returned: 1, total: 5001, hasMore: false, nextOffset: null, complete: false, incompleteReason: "sales_diagnostic_offset_cap", continuation: "refine the filters" } }));
    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{}} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Incomplete bounded investigation/)).toBeTruthy();
    expect(screen.getByText(/refine the filters/)).toBeTruthy();
    expect(screen.queryByText(/Continue with offset/)).toBeNull();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
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
        diagnosticsEndpoint="/api/sales/diagnostics"
        fetchAdmin={fetchAdmin}
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByText("This view is limited to local Sales record diagnostics.")).toBeTruthy();
    expect(fetchAdmin).toHaveBeenCalledWith("/api/sales/diagnostics?source=sales-records&limit=50&offset=0");
    expect(screen.queryByLabelText("Source")).toBeNull();

    await user.type(screen.getByPlaceholderText("corr-123"), "corr-sales");
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/sales/diagnostics?source=sales-records&correlationId=corr-sales&limit=50&offset=0"));

    await user.click(screen.getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/sales/diagnostics?source=sales-records&limit=50&offset=0"));
  });

  it("requests launch activity for only the selected participant subject", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(
      json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }),
    );

    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ source: "sales-participant-launch", subjectId: "participant-1" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith("/api/sales/diagnostics?source=sales-participant-launch&subjectId=participant-1&limit=50&offset=0"));
  });

  it("shows and operates the navigated Subject ID constraint", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }));
    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectId: "enrollment-1" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("Investigation starting subject ID") as HTMLInputElement).value).toBe("enrollment-1");
    expect(screen.getByText(/investigation starting subject ID/)).toBeTruthy();
    await user.clear(screen.getByLabelText("Investigation starting subject ID"));
    await user.type(screen.getByLabelText("Investigation starting subject ID"), "offering-1");
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply Filters" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(fetchAdmin).toHaveBeenLastCalledWith("/api/sales/diagnostics?subjectId=offering-1&limit=50&offset=0");
    await user.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(screen.queryByText(/investigation starting subject ID/)).toBeNull();
  });

  it("shows and sends the typed investigation subject alongside a colliding ID", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }));
    render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_enrollment", subjectId: "same-id" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    expect((screen.getByLabelText("Investigation starting subject type") as HTMLInputElement).value).toBe("sales_trial_enrollment");
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply Filters" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    await waitFor(() => expect(fetchAdmin).toHaveBeenLastCalledWith("/api/sales/diagnostics?subjectId=same-id&subjectType=sales_trial_enrollment&limit=50&offset=0"));
    await user.clear(screen.getByLabelText("Investigation starting subject type"));
    await user.click(screen.getByRole("button", { name: "Apply Filters" }));
    expect(fetchAdmin).toHaveBeenLastCalledWith("/api/sales/diagnostics?subjectId=same-id&limit=50&offset=0");
  });

  it("explains the intentional workflow scope for enrollment and Offering investigations", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }));
    const { rerender } = render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_enrollment", subjectId: "enrollment-1" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalled());
    expect(screen.getByLabelText("Investigation starting subject type")).toBeTruthy();
    expect(screen.getByLabelText("Investigation starting subject ID")).toBeTruthy();
    expect(screen.getByText((_, element) => element?.textContent === "Investigating enrollment enrollment-1 and its parent Offering workflow evidence.")).toBeTruthy();
    expect(screen.queryByText(/Filtered to investigation subject type/)).toBeNull();
    expect(screen.queryByText(/Filtered to subject ID \(enrollment or parent Offering\)/)).toBeNull();

    await act(async () => { rerender(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_offering", subjectId: "offering-1" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />); });
    expect(document.body.textContent).toContain("Investigating Offering offering-1 evidence.");
  });

  it("qualifies investigation scope when a source partition is present", async () => {
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>().mockResolvedValue(json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } }));
    const { rerender } = render(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", source: "sales-trial-enrollment" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />);
    await waitFor(() => expect(document.body.textContent).toContain("Investigating enrollment enrollment-1 evidence only in Source sales-trial-enrollment."));
    await act(async () => { rerender(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", source: "sales-trial-offerings" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />); });
    expect(document.body.textContent).toContain("Investigating parent Offering workflow evidence for enrollment enrollment-1 only in Source sales-trial-offerings.");
    await act(async () => { rerender(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_offering", subjectId: "offering-1", source: "sales-trial-offerings" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />); });
    expect(document.body.textContent).toContain("Investigating Offering offering-1 evidence in Source sales-trial-offerings.");
    await act(async () => { rerender(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_offering", subjectId: "offering-1", source: "sales-trial-enrollment" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />); });
    expect(document.body.textContent).toContain("Investigation starts at Offering offering-1; Source sales-trial-enrollment has no matching Offering workflow evidence.");
    await act(async () => { rerender(<AdminSupportFeature active view="diagnostics" diagnosticFilters={{ subjectType: "sales_trial_enrollment", subjectId: "enrollment-1", source: "sales-records" }} diagnosticsEndpoint="/api/sales/diagnostics" fetchAdmin={fetchAdmin} onNavigate={vi.fn()} />); });
    expect(document.body.textContent).toContain("Source sales-records has no matching enrollment or parent Offering workflow evidence");
  });
});
