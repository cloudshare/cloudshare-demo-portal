/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { AdminExamCatalogAuthoringFeature } from "./admin-exam-catalog-authoring";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AdminExamCatalogAuthoringFeature", () => {
  it("keeps CloudShare authoring failures supportable through the shell-owned Support route", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>(async (input) => {
      if (String(input) === "/api/admin/exams") return json({ activeExams: [], archivedExams: [] });
      return json({
        error: "CloudShare resources unavailable",
        correlationId: "corr-exam-authoring-1",
        diagnostic: { method: "GET", path: "/api/v3/projects", failureMode: "upstream_503", responseStatus: 503 },
      }, 503);
    });

    render(
      <AdminExamCatalogAuthoringFeature
        active
        examView="create"
        focusedExamId={null}
        fetchAdmin={fetchAdmin}
        onNavigate={onNavigate}
        onCatalogChange={vi.fn()}
        getHasActiveCohortSessions={() => false}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toContain("CloudShare resources unavailable");
    await user.click(screen.getByRole("button", { name: "corr-exam-authoring-1" }));
    expect(onNavigate).toHaveBeenCalledWith({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: { correlationId: "corr-exam-authoring-1" },
    });
  });

  it("loads Project-first resources and saves a draft through the unchanged Exam API contract", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>(async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [], archivedExams: [] });
      if (url === "/api/admin/exam-authoring") {
        return json({
          projects: [{ id: "project-1", name: "Helios Project" }],
          regions: [{ id: "region-1", name: "useast", friendlyName: "US East" }],
        });
      }
      if (url === "/api/admin/exam-authoring/projects/project-1?refresh=true") {
        return json({
          blueprints: [{ id: "blueprint-1", name: "Cloud Admin Blueprint" }],
          policies: [{ id: "policy-1", name: "One hour", runtimeLeaseMinutes: 60, storageLeaseMinutes: 120 }],
        });
      }
      if (url === "/api/admin/exam-authoring/projects/project-1/blueprints/blueprint-1?refresh=true") {
        return json({
          blueprint: {
            id: "blueprint-1",
            name: "Cloud Admin Blueprint",
            description: "A <strong>CloudShare</strong> Exam.",
            defaultSnapshotId: "snapshot-1",
            snapshots: [{ id: "snapshot-1", name: "Default snapshot", isDefault: true, regionIds: ["region-1"] }],
          },
        });
      }
      if (url === "/api/admin/exams" && init?.method === "POST") return json({});
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <AdminExamCatalogAuthoringFeature
        active
        examView="create"
        focusedExamId={null}
        fetchAdmin={fetchAdmin}
        onNavigate={onNavigate}
        onCatalogChange={vi.fn()}
        getHasActiveCohortSessions={() => false}
      />,
    );

    expect(await screen.findByRole("option", { name: "Helios Project" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Exam title" }) as HTMLInputElement).value).toBe("Cloud Admin Blueprint");
    expect((screen.getByRole("spinbutton", { name: /Open period \(minutes\)/ }) as HTMLInputElement).value).toBe("60");
    await user.click(screen.getByRole("checkbox", { name: "US East" }));
    await user.clear(screen.getByRole("textbox", { name: "Exam title" }));
    await user.type(screen.getByRole("textbox", { name: "Exam title" }), "Helios Cloud Admin");
    await user.click(screen.getByRole("button", { name: "Save Draft Exam" }));

    await waitFor(() => expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/exams", expect.objectContaining({ method: "POST" })));
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/exams", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        title: "Helios Cloud Admin",
        description: "A CloudShare Exam.",
        scoreRetrievalEnabled: false,
        deliveryAvailability: "individual",
        allowedRegionIds: ["region-1"],
        policyId: "policy-1",
        openPeriodMinutes: 60,
        projectId: "project-1",
        projectName: "Helios Project",
        blueprintId: "blueprint-1",
        blueprintName: "Cloud Admin Blueprint",
        snapshotId: "snapshot-1",
        snapshotName: "Default snapshot",
        policyName: "One hour",
      }),
    }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "exams", examView: "catalog" });
  });
});
