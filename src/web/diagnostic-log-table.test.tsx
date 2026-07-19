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
