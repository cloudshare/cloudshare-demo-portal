/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionParticipants, SalesWorkspace } from "./sales-workspace";

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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);

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

  it("cancels unsaved Item authoring and returns to the catalogue without saving", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/sales/items" && !init?.method) return json({ activeItems: [], archivedItems: [] });
      if (url === "/api/sales/item-authoring?refresh=true") return json({ projects: [], regions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);

    await user.click(await screen.findByRole("button", { name: "Create Item" }));
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Unsaved Item");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await screen.findByRole("heading", { name: "Item catalogue" });
    expect(router.push).toHaveBeenLastCalledWith("/sales?tab=items");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sales/items", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/sales/items/"), expect.objectContaining({ method: "PUT" }));
  });

  it("keeps both authoring exits unavailable while an Item save is in flight", async () => {
    const user = userEvent.setup();
    const saveResponse = deferred<Response>();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/sales/items" && !init?.method) return json({ activeItems: [], archivedItems: [] });
      if (url === "/api/sales/item-authoring?refresh=true") return json({ projects: [], regions: [] });
      if (url === "/api/sales/items" && init?.method === "POST") return saveResponse.promise;
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);

    await user.click(await screen.findByRole("button", { name: "Create Item" }));
    await user.type(screen.getByRole("textbox", { name: "Item name" }), "Saving Item");
    await user.click(screen.getByRole("button", { name: "Save Item" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Back to catalogue" })).toHaveProperty("disabled", true);
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    });
    saveResponse.resolve(json({ item: { id: "item-1" } }, 201));
    await screen.findByRole("heading", { name: "Item catalogue" });
  });

  it("links a live resource failure to Sales Support without rendering raw diagnostics", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/sales/items" && !init?.method) return json({ activeItems: [], archivedItems: [] });
      if (url === "/api/sales/item-authoring?refresh=true") return json({ error: "CloudShare is temporarily rate limited.", correlationId: "corr-sales-429", diagnostic: { integrationSurface: "cloudshare.v3.projects", responseStatus: 429 } }, 429);
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);

    await user.click(await screen.findByRole("button", { name: "Create Item" }));

    expect((await screen.findByRole("alert")).textContent).toContain("CloudShare is temporarily rate limited.");
    expect(screen.queryByLabelText("Support diagnostics")).toBeNull();
    await user.click(screen.getByRole("button", { name: "corr-sales-429" }));
    expect(router.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-sales-429");
  });
});

describe("Sales Participant monitoring", () => {
  it("keeps the invitation Select control as the first monitoring column", async () => {
    const fetchSales = vi.fn().mockImplementation(async (input: string) => {
      if (input === "/api/sales/accounts") return json({ contacts: [{ id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", archivedAt: null }] });
      if (input === "/api/sales/enablement-sessions/session-1/participants") return json({ participants: [{ id: "portal-1", opportunityContactId: "contact-1", firstName: "Ada", lastName: "Lovelace", invitationStatus: "notSent", participationStatus: "pending", firstJoined: null, envStatus: null }] });
      return json({});
    });
    render(<SalesSessionParticipants session={{ id: "session-1", opportunityId: "opportunity-1", itemId: "item-1", type: "demo", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-17T08:00:00Z", verificationEligible: true }} fetchSales={fetchSales as typeof fetch} onOpenSupport={vi.fn()} />);

    await screen.findByRole("checkbox", { name: "Select Ada Lovelace for native invite" });
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Select", "Participant", "Invite", "First joined", "Participation", "Environment"]);
  });

  it("keeps a repairable legacy participant available for explicit correlation repair", async () => {
    const user = userEvent.setup();
    const fetchSales = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === "/api/sales/accounts") return json({ contacts: [{ id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", archivedAt: null }] });
      if (input === "/api/sales/enablement-sessions/session-1/participants" && !init?.method) return json({ participants: [{ id: "portal-1", opportunityContactId: "contact-1", firstName: "Ada", lastName: "Lovelace", invitationStatus: "notSent", participationStatus: "pending", firstJoined: null, envStatus: null, needsAttention: true, requiresCorrelationRepair: true, monitoringMessage: "CloudShare returned this participant without its Certalis correlation properties." }] });
      if (input === "/api/sales/enablement-sessions/session-1/participants") return json({ participants: [{ id: "portal-1", opportunityContactId: "contact-1", firstName: "Ada", lastName: "Lovelace", invitationStatus: "notSent", participationStatus: "pending", firstJoined: null, envStatus: null }], correlationId: "corr-repair-1" }, 201);
      return json({});
    });
    render(<SalesSessionParticipants session={{ id: "session-1", opportunityId: "opportunity-1", itemId: "item-1", type: "demo", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-17T08:00:00Z", verificationEligible: true }} fetchSales={fetchSales as typeof fetch} onOpenSupport={vi.fn()} />);

    expect(await screen.findByLabelText("Ada Lovelace (repair CloudShare correlation)")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Register or repair selected participants" })).not.toBeNull();
    await user.click(screen.getByLabelText("Ada Lovelace (repair CloudShare correlation)"));
    await user.click(screen.getByRole("button", { name: "Register or repair selected participants" }));
    await waitFor(() => expect(screen.queryByLabelText("Ada Lovelace (repair CloudShare correlation)")).toBeNull());
    expect((screen.getByRole("checkbox", { name: "Select Ada Lovelace for native invite" }) as HTMLInputElement).disabled).toBe(false);
  });
});
