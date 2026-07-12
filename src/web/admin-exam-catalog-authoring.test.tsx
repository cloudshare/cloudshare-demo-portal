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
  it("keeps the persisted Exam time limit visible while editing an Exam whose Policy is no longer available", async () => {
    const user = userEvent.setup();
    const stalePolicyExam = {
      id: "exam-stale-policy", title: "Stale policy Exam", description: "Existing draft", timeLimitMinutes: 75,
      openPeriodMinutes: 90, scoreRetrievalEnabled: false, deliveryAvailability: "individual" as const,
      status: "draft" as const, publishedAt: null, projectId: "project-1", projectName: "Project One",
      blueprintId: "blueprint-1", blueprintName: "Blueprint One", snapshotId: "snapshot-1", snapshotName: "Snapshot One",
      allowedRegions: [{ id: "region-1", name: "US East" }], policyId: "policy-retired", policyName: "Retired Policy", instructorName: "Service account",
    };
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>(async (input) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [stalePolicyExam], archivedExams: [] });
      if (url === "/api/admin/exam-authoring") return json({ projects: [{ id: "project-1", name: "Project One" }], regions: [{ id: "region-1", name: "US East" }] });
      if (url === "/api/admin/exam-authoring/projects/project-1" || url === "/api/admin/exam-authoring/projects/project-1?refresh=true") return json({ blueprints: [{ id: "blueprint-1", name: "Blueprint One" }], policies: [] });
      if (url === "/api/admin/exam-authoring/projects/project-1/blueprints/blueprint-1") return json({ blueprint: { id: "blueprint-1", name: "Blueprint One", description: "", defaultSnapshotId: "snapshot-1", snapshots: [{ id: "snapshot-1", name: "Snapshot One", isDefault: true, regionIds: ["region-1"] }] } });
      throw new Error(`Unexpected request: ${url}`);
    });
    function FeatureHarness() {
      const [view, setView] = React.useState<"catalog" | "edit" | "create">("catalog");
      return <AdminExamCatalogAuthoringFeature active examView={view} focusedExamId={view === "edit" ? stalePolicyExam.id : null} fetchAdmin={fetchAdmin} onNavigate={(intent) => setView(intent.examView === "create" || intent.examView === "edit" ? intent.examView : "catalog")} onCatalogChange={vi.fn()} getHasActiveCohortSessions={() => false} />;
    }

    render(<FeatureHarness />);
    await user.click(await screen.findByRole("button", { name: "Edit Exam" }));

    expect((await screen.findByRole("spinbutton", { name: /Time limit \(minutes\)/ }) as HTMLInputElement).value).toBe("75");
    expect((screen.getByRole("spinbutton", { name: /Open period \(minutes\)/ }) as HTMLInputElement).value).toBe("90");
    expect((screen.getByRole("combobox", { name: "Policy" }) as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Cancel Edit" }));
    await user.click(await screen.findByRole("button", { name: "Create Exam" }));
    expect((await screen.findByRole("spinbutton", { name: /Open period \(minutes\)/ }) as HTMLInputElement).value).toBe("75");
  });

  it("refreshes dependent Project resources, shows the read-only default Snapshot, and reconciles Region validation", async () => {
    const user = userEvent.setup();
    const fetchAdmin = vi.fn<AdminAuthenticatedRequest>(async (input) => {
      const url = String(input);
      if (url === "/api/admin/exams") return json({ activeExams: [], archivedExams: [] });
      if (url === "/api/admin/exam-authoring") {
        return json({
          projects: [{ id: "project-1", name: "Project One" }, { id: "project-2", name: "Project Two" }],
          regions: [{ id: "region-1", name: "useast", friendlyName: "US East" }],
        });
      }
      if (url === "/api/admin/exam-authoring/projects/project-1?refresh=true") {
        return json({ blueprints: [{ id: "blueprint-1", name: "Blueprint One" }], policies: [{ id: "policy-1", name: "One hour", runtimeLeaseMinutes: 60 }] });
      }
      if (url === "/api/admin/exam-authoring/projects/project-1/blueprints/blueprint-1?refresh=true") {
        return json({ blueprint: { id: "blueprint-1", name: "Blueprint One", description: "", defaultSnapshotId: "snapshot-1", snapshots: [{ id: "snapshot-1", name: "Snapshot One", isDefault: true, regionIds: ["region-1"] }] } });
      }
      if (url === "/api/admin/exam-authoring/projects/project-2?refresh=true") {
        return json({ blueprints: [{ id: "blueprint-2", name: "Blueprint Two" }], policies: [{ id: "policy-2", name: "Forty-five minutes", runtimeLeaseMinutes: 45 }] });
      }
      if (url === "/api/admin/exam-authoring/projects/project-2/blueprints/blueprint-2?refresh=true") {
        return json({ blueprint: { id: "blueprint-2", name: "Blueprint Two", description: "", defaultSnapshotId: "snapshot-2", snapshots: [{ id: "snapshot-2", name: "Snapshot Two", isDefault: true, regionIds: ["region-not-deployed"] }] } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<AdminExamCatalogAuthoringFeature active examView="create" focusedExamId={null} fetchAdmin={fetchAdmin} onNavigate={vi.fn()} onCatalogChange={vi.fn()} getHasActiveCohortSessions={() => false} />);

    expect(await screen.findByText("Snapshot One (default)")).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "project-2");

    expect(await screen.findByText("Snapshot Two (default)")).toBeTruthy();
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/exam-authoring/projects/project-2?refresh=true");
    expect(fetchAdmin).toHaveBeenCalledWith("/api/admin/exam-authoring/projects/project-2/blueprints/blueprint-2?refresh=true");
    expect((screen.getByRole("spinbutton", { name: /Open period \(minutes\)/ }) as HTMLInputElement).value).toBe("45");
    expect(screen.getByText("No deployed Regions found for the current default Snapshot.")).toBeTruthy();
    expect(screen.getByText("The selected Blueprint default Snapshot is not deployed to any Regions yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Draft Exam" }).hasAttribute("disabled")).toBe(true);
  });

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
    const openPeriodInput = screen.getByRole("spinbutton", { name: /Open period \(minutes\)/ }) as HTMLInputElement;
    expect(openPeriodInput.value).toBe("60");
    expect(openPeriodInput.getAttribute("aria-describedby")).toBe("exam-open-period-help exam-form-feedback");
    expect(document.getElementById("exam-open-period-help")?.textContent).toContain("CloudShare Experience duration from scheduled start");
    await user.click(screen.getByRole("checkbox", { name: /US East/ }));
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

    await user.clear(openPeriodInput);
    await user.click(screen.getByRole("button", { name: "Save Draft Exam" }));
    const feedback = document.getElementById("exam-form-feedback");
    expect(feedback?.textContent).toBe("Open period must be a positive whole number of minutes.");
    expect(feedback?.style.background).toBe("rgb(255, 245, 247)");
    expect(feedback?.style.border).toBe("1px solid rgb(241, 199, 208)");
  });
});
