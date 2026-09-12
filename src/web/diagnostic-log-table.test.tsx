/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { DiagnosticLogTable, type DiagnosticLogTableEntry } from "./diagnostic-log-table";

const baseEntry: DiagnosticLogTableEntry = { id: "diag-local", occurredAt: "2026-07-19T12:00:00.000Z", level: "warn", source: "sales-demo-sessions", operation: "sales.demo_session.created", outcome: "failure", customerId: "certalis", actor: { type: "admin", id: "admin-1" }, subject: { type: "sales_demo_session", id: "session-1" }, message: "Certalis could not reserve the Sales Enablement Session locally.", correlationId: "corr-local", candidateEmail: null, examId: null, examAttemptId: null, details: { integrationSurface: "portal.sales_demo_sessions", failureMode: "local_reservation_persistence", cloudShareAttempted: false } };

function Harness(props: { entry: DiagnosticLogTableEntry }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return <DiagnosticLogTable entries={[props.entry]} expandedDiagnosticId={expanded} onToggleExpanded={(id) => setExpanded((current) => current === id ? null : id)} />;
}

describe("DiagnosticLogTable Support hints", () => {
  it("uses the captured CloudShare surface as the Operation label for Session and Trial transport rows", () => {
    const { container } = render(<DiagnosticLogTable entries={[
      { ...baseEntry, id: "session", operation: "cloudshare.request", details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3" } },
      { ...baseEntry, id: "trial", operation: "sales_trial.cloudshare.request", details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3.projects" } },
    ]} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    expect(container.textContent).toContain("cloudshare.v3");
    expect(container.textContent).toContain("cloudshare.v3.projects");
    expect(container.textContent).toContain("cloudshare.request");
    expect(container.textContent).toContain("sales_trial.cloudshare.request");
  });

  it("uses the shared surface for Session and Trial OAuth rows and falls back for blank history", () => {
    const { container } = render(<DiagnosticLogTable entries={[
      { ...baseEntry, id: "session-oauth", operation: "cloudshare.oauth.token", details: { evidenceKind: "transport", integrationSurface: " cloudshare.v4.oauth.token " } },
      { ...baseEntry, id: "trial-oauth", operation: "sales_trial.cloudshare.oauth_token", details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4.oauth.token" } },
      { ...baseEntry, id: "legacy", operation: "cloudshare.request", details: { evidenceKind: "transport", integrationSurface: "   " } },
    ]} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    expect(container.textContent).toContain("cloudshare.v4.oauth.token");
    expect(container.textContent).toContain("cloudshare.request");
    expect(container.textContent).toContain("sales_trial.cloudshare.oauth_token");
  });

  it("derives a specific v3 label from retained Session request evidence without rewriting the entry", () => {
    const { container } = render(<DiagnosticLogTable entries={[
      { ...baseEntry, id: "historical-session", operation: "cloudshare.request", request: { method: "GET", path: "/api/v3/projects/project-private/blueprints" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3" } },
    ]} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    expect(container.textContent).toContain("cloudshare.v3.projects.blueprints");
    expect(container.textContent).toContain("Attempted operation: cloudshare.request");
  });

  it("derives specific v3 labels for retained Trial environment evidence", () => {
    const { container } = render(<DiagnosticLogTable entries={[
      { ...baseEntry, id: "trial-environment-list", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/api/v3/envs" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3" } },
      { ...baseEntry, id: "trial-environment-status", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/api/v3/envs/actions/getextended" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3" } },
      { ...baseEntry, id: "trial-environment-extend", operation: "sales_trial.cloudshare.request", request: { method: "PUT", path: "/api/v3/envs/actions/extend" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v3" } },
    ]} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    expect(container.textContent).toContain("cloudshare.v3.envs");
    expect(container.textContent).toContain("cloudshare.v3.env.action.getextended");
    expect(container.textContent).toContain("cloudshare.v3.env.action.extend");
  });

  it("derives specific v4 Sales labels from retained Trial request evidence", () => {
    const { container } = render(<DiagnosticLogTable entries={[
      { ...baseEntry, id: "trial-sales", operation: "sales_trial.cloudshare.request", request: { method: "POST", path: "/v4/sales" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-sales-detail", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/v4/sales/sales-private" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-participants", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/v4/sales/sales-private/participants" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-participant-detail", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/v4/sales/sales-private/participants/participant-private" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-participant-invite", operation: "sales_trial.cloudshare.request", request: { method: "POST", path: "/v4/sales/sales-private/participants/invite" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-sales-pros", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/v4/sales/sales-private/salespros" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-sales-pro-detail", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/v4/sales/sales-private/salespros/pro-private" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
      { ...baseEntry, id: "trial-unknown", operation: "sales_trial.cloudshare.request", request: { method: "GET", path: "/v4/sales/sales-private/unknown-route" }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } },
    ]} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    expect(screen.getByText("cloudshare.v4.sales")).toBeTruthy();
    expect(screen.getByText("cloudshare.v4.sales.detail")).toBeTruthy();
    expect(screen.getByText("cloudshare.v4.sales.participants")).toBeTruthy();
    expect(screen.getByText("cloudshare.v4.sales.participants.detail")).toBeTruthy();
    expect(screen.getByText("cloudshare.v4.sales.participants.invite")).toBeTruthy();
    expect(screen.getByText("cloudshare.v4.sales.salespros")).toBeTruthy();
    expect(screen.getByText("cloudshare.v4.sales.salespros.detail")).toBeTruthy();
    expect(screen.getAllByText("cloudshare.v4")).toHaveLength(1);
    expect(screen.getByText("cloudshare.v4.sales.participants").closest("td")?.textContent).not.toContain("sales-private");
  });

  it("covers every documented Sales route family and keeps unknown v4 routes generic", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["/v4/sales/sales-private/salespros/invite", "cloudshare.v4.sales.salespros.invite"],
      ["/v4/sales/sales-private/salespros/email-template", "cloudshare.v4.sales.salespros.email_template"],
      ["/v4/sales/sales-private/participants/email-template", "cloudshare.v4.sales.participants.email_template"],
      ["/v4/sales/sales-private/participants/unassigned-environment", "cloudshare.v4.sales.participants.unassigned_environment"],
      ["/v4/sales/sales-private/participants/participant-private/unassigned-environment", "cloudshare.v4.sales.participants.unassigned_environment"],
      ["/v4/sales/sales-private/users/properties", "cloudshare.v4.sales.user_properties"],
      ["/v4/sales/sales-private/users/properties/property-private", "cloudshare.v4.sales.user_properties.detail"],
      ["/v4/sales/sales-private/sponsored-link", "cloudshare.v4.sales.sponsored_link"],
      ["/v4/sales/sales-private/students/participants/participant-private/environment", "cloudshare.v4.sales.students.participants.environment"],
      ["/v4/sales/sales-private/assign-shared-env-controlling-user", "cloudshare.v4.sales.assign_shared_env_controlling_user"],
    ];
    render(<DiagnosticLogTable entries={cases.map(([path], index) => ({ ...baseEntry, id: `v4-${index}`, operation: "sales_trial.cloudshare.request", request: { method: "GET", path }, details: { evidenceKind: "transport", integrationSurface: "cloudshare.v4" } }))} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    for (const [, label] of cases) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("renders explicit transport, semantic, and legacy evidence labels with timing metadata", () => {
    const { container } = render(<DiagnosticLogTable entries={[
      { ...baseEntry, id: "transport", details: { evidenceKind: "transport", exchangeId: "ex-1", attemptStartSequence: 2, completedAt: "2026-09-10T12:00:01Z", durationMs: 12 } },
      { ...baseEntry, id: "semantic", details: { evidenceKind: "semantic" } },
      { ...baseEntry, id: "legacy", details: {} },
    ]} expandedDiagnosticId={null} onToggleExpanded={() => undefined} />);
    expect(container.textContent).toContain("Transport evidence");
    expect(container.textContent).toContain("Semantic evidence");
    expect(container.textContent).toContain("exchange ex-1");
    expect(container.textContent).toContain("start #2");
    expect(container.textContent).toContain("12ms");
  });
  it("expands local Sales persistence remediation without claiming CloudShare failed", async () => {
    const user = userEvent.setup(); render(<Harness entry={baseEntry} />);
    await user.click(screen.getByRole("button", { name: "Expand diagnostic entry diag-local" }));
    expect(screen.getByText("Sales Enablement Session reservation could not be saved")).toBeTruthy();
    expect(screen.getByText(/No CloudShare operation was attempted/)).toBeTruthy();
    expect(screen.queryByText("CloudShare request failed")).toBeNull();
  });

  it("expands a confirmed local revision collision without claiming CloudShare failed", async () => {
    const user = userEvent.setup(); render(<Harness entry={{ ...baseEntry, id: "diag-collision", details: { integrationSurface: "portal.sales_demo_sessions", failureMode: "revision_collision", cloudShareAttempted: false } }} />);
    await user.click(screen.getByRole("button", { name: "Expand diagnostic entry diag-collision" }));
    expect(screen.getByText("Sales Enablement Session revision is already reserved")).toBeTruthy(); expect(screen.getByText(/No CloudShare operation was attempted/)).toBeTruthy(); expect(screen.queryByText("CloudShare request failed")).toBeNull();
  });

  it("preserves the external-failure wording for a real CloudShare operation", async () => {
    const user = userEvent.setup(); render(<Harness entry={{ ...baseEntry, id: "diag-cloudshare", details: { integrationSurface: "cloudshare.v4.sales", failureMode: "http_status", cloudShareAttempted: true } }} />);
    await user.click(screen.getByRole("button", { name: "Expand diagnostic entry diag-cloudshare" }));
    expect(screen.getByText("CloudShare request failed")).toBeTruthy();
  });
});
