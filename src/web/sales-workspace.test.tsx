/** @vitest-environment jsdom */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("SalesWorkspace", () => {
  it("server-renders the initial Sales workspace without browser globals", () => {
    const html = renderToStaticMarkup(
      createElement(SalesWorkspace, { email: "sales-admin@certalis.demo" }),
    );

    expect(html).toContain("Sales Workspace");
    expect(html).toContain("Accounts");
    expect(html).toContain("Opportunities");
    expect(html).toContain("Opportunity Contacts");
    expect(html).toContain('href="/sales/diagnostics"');
    expect(html).toContain("Demo Item catalog");
    expect(html).toContain("Create Demo Item");
    expect(html).toContain("No active Demo Items yet.");
  });

  it("drives live-resource controls to save an ordered Demo Item and shows the default Policy duration", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales/demo-items" && !init?.method) return json({ activeDemoItems: [], archivedDemoItems: [] });
      if (url === "/api/sales/demo-item-authoring?refresh=true") return json({ projects: [{ id: "project-1", name: "Certalis Project" }], regions: [{ id: "region-1", name: "US West", friendlyName: "US West" }] });
      if (url === "/api/sales/demo-item-authoring/projects/project-1?refresh=true") return json({ blueprints: [{ id: "bp-1", name: "Foundation" }, { id: "bp-2", name: "Advanced" }], policies: [{ id: "policy-1", name: "Sales policy", storageLeaseMinutes: 1440 }] });
      if (url === "/api/sales/demo-items" && init?.method === "POST") return json({ demoItem: { id: "demo-1" } }, 201);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(SalesWorkspace, { email: "sales-admin@certalis.demo" }));

    await user.click(await screen.findByRole("button", { name: "Load live CloudShare resources" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "project-1");
    await user.click(await screen.findByRole("checkbox", { name: "Advanced" }));
    await user.click(screen.getByRole("checkbox", { name: "Foundation" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Policy" }), "policy-1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Region" }), "region-1");
    await user.type(screen.getByRole("textbox", { name: "Demo Item name" }), "CX discovery demo");
    expect(await screen.findByText("Default duration: 1440 minutes (Policy storage lease)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save Demo Item" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/demo-items", expect.objectContaining({ method: "POST" })));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/demo-items", expect.objectContaining({ body: JSON.stringify({ name: "CX discovery demo", description: "", projectId: "project-1", blueprintIds: ["bp-2", "bp-1"], policyId: "policy-1", regionId: "region-1", salesExperienceType: "demo" }) }));
  });

  it("clicks the reachable inspect, edit, and archive controls for an existing Demo Item", async () => {
    const user = userEvent.setup();
    const item = { id: "demo-1", name: "Existing demo", description: "Existing description", project: { id: "project-1", name: "Certalis Project" }, blueprints: [{ id: "bp-1", name: "Foundation" }], policy: { id: "policy-1", name: "Sales policy" }, region: { id: "region-1", name: "US West" }, salesExperienceType: "poc", defaultDurationMinutes: 1440, status: "active" };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales/demo-items" && !init?.method) return json({ activeDemoItems: [item], archivedDemoItems: [] });
      if (url === "/api/sales/demo-items/demo-1" && !init?.method) return json({ demoItem: item });
      if (url === "/api/sales/demo-item-authoring?refresh=true") return json({ projects: [item.project], regions: [{ ...item.region, friendlyName: item.region.name }] });
      if (url === "/api/sales/demo-item-authoring/projects/project-1?refresh=true") return json({ blueprints: item.blueprints, policies: [{ ...item.policy, storageLeaseMinutes: 1440 }] });
      if (url === "/api/sales/demo-items/demo-1/archive" && init?.method === "POST") return json({ demoItem: { ...item, status: "archived" } });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(SalesWorkspace, { email: "sales-admin@certalis.demo" }));
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    expect((await screen.findByRole("region", { name: "Demo Item inspection" })).textContent).toContain("Existing description");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Edit Demo Item" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/demo-items/demo-1/archive", expect.objectContaining({ method: "POST" })));
  });
});
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

