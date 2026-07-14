/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const deferred = <T,>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>((done) => { resolve = done; }), resolve }; };

describe("Sales Item authoring", () => {
  afterEach(() => { vi.restoreAllMocks(); router.push.mockClear(); });

  it("numbers Blueprint steps by selection order, reindexes on removal, and posts only shared default-Snapshot Regions", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/sales/items" && !init?.method) return json({ activeItems: [], archivedItems: [] });
      if (url === "/api/sales/item-authoring?refresh=true") return json({ projects: [{ id: "project-1", name: "Certalis Sales" }], regions: [{ id: "miami", name: "Miami", friendlyName: "Miami" }, { id: "amsterdam", name: "Amsterdam", friendlyName: "Amsterdam" }] });
      if (url === "/api/sales/item-authoring/projects/project-1?refresh=true") return json({ blueprints: [{ id: "foundation", name: "Foundation", defaultSnapshotRegionIds: ["miami", "amsterdam"] }, { id: "advanced", name: "Advanced", defaultSnapshotRegionIds: ["miami"] }], policies: [{ id: "policy-1", name: "One day", storageLeaseMinutes: 1440 }] });
      if (url === "/api/sales/items" && init?.method === "POST") return json({ item: { id: "item-1" } }, 201);
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    await user.click(await screen.findByRole("button", { name: "Create Item" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "project-1");
    await screen.findByText("Foundation");
    const [foundation, advanced] = screen.getAllByRole("checkbox");
    await user.click(advanced);
    await user.click(foundation);
    await waitFor(() => expect(screen.getByText("Advanced").closest("label")?.textContent).toContain("Step 1"));
    expect(screen.getByText("Foundation").closest("label")?.textContent).toContain("Step 2");
    expect(screen.queryByText("Amsterdam")).toBeNull();
    await user.click(advanced);
    await waitFor(() => expect(screen.getByText("Foundation").closest("label")?.textContent).toContain("Step 1"));
    expect(screen.getByText("Amsterdam")).not.toBeNull();
    expect(screen.queryByText(/Step 2:/)).toBeNull();
    await user.click(screen.getByText("Amsterdam"));
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Regional POC");
    await user.selectOptions(screen.getByRole("combobox", { name: "Policy" }), "policy-1");
    await user.click(screen.getByRole("button", { name: "Save Item" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/items", expect.objectContaining({ method: "POST", body: expect.stringContaining('"regionIds":["amsterdam"]') })));
  });

  it("refreshes the selected Project's live Blueprint list on demand", async () => {
    const user = userEvent.setup();
    let projectReadCount = 0;
    const refreshedResources = deferred<Response>();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/sales/items" && !init?.method) return json({ activeItems: [], archivedItems: [] });
      if (url === "/api/sales/item-authoring?refresh=true") return json({ projects: [{ id: "project-1", name: "Certalis Sales" }], regions: [] });
      if (url === "/api/sales/item-authoring/projects/project-1?refresh=true") {
        projectReadCount += 1;
        return projectReadCount === 1
          ? json({ blueprints: [{ id: "old", name: "Original Blueprint", defaultSnapshotRegionIds: ["miami"] }], policies: [] })
          : refreshedResources.promise;
      }
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" />);

    await user.click(await screen.findByRole("button", { name: "Create Item" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "project-1");
    await screen.findByText("Original Blueprint");
    await user.click(screen.getByRole("button", { name: "Refresh live resources" }));
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveProperty("disabled", true);
    refreshedResources.resolve(json({ blueprints: [{ id: "new", name: "Newly added Blueprint", defaultSnapshotRegionIds: ["miami"] }], policies: [] }));

    expect(await screen.findByText("Newly added Blueprint")).not.toBeNull();
    expect(screen.queryByText("Original Blueprint")).toBeNull();
    expect(projectReadCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
