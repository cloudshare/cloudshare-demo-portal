/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";

const { mockRouter, mockSearchParams } = vi.hoisted(() => ({
  mockRouter: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  mockSearchParams: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter, useSearchParams: () => mockSearchParams }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const chooseSearchableOption = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
};

describe("SalesWorkspace interaction", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); mockSearchParams.delete("accountId"); mockSearchParams.delete("opportunityId"); mockRouter.push.mockClear(); mockRouter.replace.mockClear(); window.history.replaceState({}, "", "/sales"); });

  it("selects an Account into the URL and limits the next grid to its Opportunities without console errors", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return json({ account: { id: "account-1" } }, 201);
      return json({
        accounts: [
          { id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" },
          { id: "account-2", name: "Helios CX", kind: "current_customer", archivedAt: null, createdAt: "2026-07-11T17:00:00.000Z" },
        ],
        opportunities: [
          { id: "opportunity-1", accountId: "account-1", name: "Acme proof", status: "open", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" },
          { id: "opportunity-2", accountId: "account-2", name: "Helios renewal", status: "won", archivedAt: null, createdAt: "2026-07-11T17:00:00.000Z" },
        ], contacts: [],
      });
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    const acmeRow = await screen.findByRole("row", { name: /Acme Labs/ });
    await user.click(acmeRow);

    expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=records&accountId=account-1", { scroll: false });
    expect(acmeRow.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Acme proof")).not.toBeNull();
    expect(screen.queryByText("Helios renewal")).toBeNull();
    expect(screen.getByRole("region", { name: "Opportunities" }).textContent).toContain("Selected Account: Acme Labs");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("creates a time-bound Sales Enablement Session with a Sales Admin end-time override through the browser API flow without console errors", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", label: "Acme - Acme evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") return json({ session: { id: "session-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T09:00", end: "2026-07-17T10:15", timeZone: "UTC", salesProDisplayName: "Sales Rep", createdAt: "2026-07-14T15:00:00.000Z" } }, 201);
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await screen.findByRole("combobox", { name: "Opportunity" });
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation");
    await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1");
    await user.click(screen.getByRole("radio", { name: "Schedule start" }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-07-17T09:15" } });
    const end = screen.getByLabelText("End") as HTMLInputElement;
    await waitFor(() => expect(end.value).not.toBe(""));
    fireEvent.change(end, { target: { value: "2026-07-17T10:15" } });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    await screen.findByText("Sales Enablement Session created. No invitations were sent.");
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions", expect.objectContaining({ method: "POST", body: expect.stringContaining('"start":"2026-07-17T09:15"') }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions", expect.objectContaining({ method: "POST", body: expect.stringContaining('"end":"2026-07-17T10:15"') }));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("filters the combined Opportunity selector and retains the viewport when a selection changes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-north", accountId: "account-1", accountName: "Acme", name: "North renewal", label: "Acme - North renewal" }, { id: "opp-south", accountId: "account-1", accountName: "Acme", name: "South renewal", label: "Acme - South renewal" }], total: 2 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    const opportunity = await screen.findByRole("combobox", { name: "Opportunity" });
    await user.type(opportunity, "North");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input, init]) =>
        String(input).includes("search=North") &&
        (init as RequestInit | undefined)?.cache === "no-store" &&
        (init as RequestInit | undefined)?.signal instanceof AbortSignal,
      )).toBe(true),
    );
    expect(screen.getByRole("option", { name: "Acme - North renewal" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Previous opportunities|Next opportunities/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: "Acme - North renewal" }));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions&opportunityId=opp-north", { scroll: false });
    await waitFor(() => expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("Acme - North renewal (1) - Item"));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("search=Acme+-+North+renewal"))).toBe(false);
  });

  it("closes a Sales selector on blur and clears both Account and Opportunity filters", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", accountName: "Acme", name: "North renewal", label: "Acme - North renewal" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], freshness: "fresh", preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);

    const accountSelector = screen.getByTestId("account-results-selector");
    expect(accountSelector.children).toHaveLength(3);
    await user.click(await screen.findByRole("combobox", { name: "Account" }));
    const accountResults = await screen.findByRole("listbox", { name: "Account results" });
    expect(accountSelector.children).toHaveLength(3);
    expect(accountResults.parentElement?.style.position).toBe("absolute");
    await user.click(screen.getByLabelText("Time zone"));
    expect(screen.queryByRole("listbox", { name: "Account results" })).toBeNull();

    await chooseSearchableOption(user, "Account", "Acme");
    expect((screen.getByRole("button", { name: "Clear Account and Opportunity filters" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Clear Account and Opportunity filters" }));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions", { scroll: false });
    expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLInputElement).value).toBe("");
  });

  it("selects an Account from the combined selector entirely by keyboard", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }, { id: "account-2", name: "Brio" }], opportunities: [], total: 0 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);

    const account = await screen.findByRole("combobox", { name: "Account" });
    await user.click(account);
    await screen.findByRole("option", { name: "Acme" });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions&accountId=account-1", { scroll: false });
    expect((account as HTMLInputElement).value).toBe("Acme");
  });

  it("does not replace a newer Opportunity search result with an aborted stale response", async () => {
    const user = userEvent.setup();
    let resolveInitial: ((response: Response) => void) | undefined;
    vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) {
        if (path.includes("search=North")) return Promise.resolve(json({ accounts: [], opportunities: [{ id: "north", accountId: "account-1", accountName: "Acme", name: "North", label: "Acme - North" }], total: 1 }));
        if (!resolveInitial) return new Promise<Response>((resolve) => { resolveInitial = resolve; });
        return Promise.resolve(json({ accounts: [], opportunities: [], total: 0 }));
      }
      if (path === "/api/sales/items") return Promise.resolve(json({ activeItems: [] }));
      if (path === "/api/sales/timezones" && !init?.method) return Promise.resolve(json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} }));
      if (path === "/api/sales/timezones" && init?.method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      if (path.startsWith("/api/sales/enablement-sessions?")) return Promise.resolve(json({ sessions: [] }));
      return Promise.resolve(json({}));
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await waitFor(() => expect(resolveInitial).toBeDefined());
    const opportunity = await screen.findByRole("combobox", { name: "Opportunity" });
    await user.type(opportunity, "North");
    expect(await screen.findByRole("option", { name: "Acme - North" })).not.toBeNull();

    resolveInitial?.(json({ accounts: [], opportunities: [{ id: "stale", accountId: "account-1", accountName: "Acme", name: "Stale", label: "Acme - Stale" }], total: 1 }));

    await waitFor(() => expect(screen.queryByRole("option", { name: "Acme - Stale" })).toBeNull());
    expect(screen.getByRole("option", { name: "Acme - North" })).not.toBeNull();
  });

  it("shows an actionable error when active Account and Opportunity choices cannot load", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ error: "Active Sales records are temporarily unavailable." }, 502);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await user.click(await screen.findByRole("combobox", { name: "Opportunity" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Active Sales records are temporarily unavailable.");
  });

  it("loads further active Opportunities only when the Sales Admin requests more results", async () => {
    const user = userEvent.setup();
    const firstPage = Array.from({ length: 20 }, (_, index) => ({ id: `opp-${index + 1}`, accountId: "account-1", accountName: "Acme", name: `Opportunity ${index + 1}`, label: `Acme - Opportunity ${index + 1}` }));
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return path.includes("page=2")
        ? json({ accounts: [], accountTotal: 0, opportunities: [{ id: "opp-21", accountId: "account-1", accountName: "Acme", name: "Opportunity 21", label: "Acme - Opportunity 21" }], total: 21 })
        : json({ accounts: [], accountTotal: 0, opportunities: firstPage, total: 21 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await user.click(await screen.findByRole("combobox", { name: "Opportunity" }));
    await screen.findByRole("option", { name: "Acme - Opportunity 20" });
    expect(screen.queryByRole("option", { name: "Acme - Opportunity 21" })).toBeNull();
    const loadMore = screen.getByRole("button", { name: "Load more opportunity" });
    await user.tab();
    expect(document.activeElement).toBe(loadMore);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("option", { name: "Acme - Opportunity 21" })).not.toBeNull();
  });

  it("shows support diagnostics when saving the default Session name template fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/session-configuration" && init?.method === "PUT") return json({ error: "The default template could not be saved.", correlationId: "corr-template-1" }, 502);
      if (path === "/api/sales/session-configuration") return json({});
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await user.click(await screen.findByRole("button", { name: "Save as default template" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The default template could not be saved.");
    await user.click(screen.getByRole("button", { name: "Open support diagnostics (corr-template-1)" }));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-template-1");
  });

  it("links a Sales Enablement Session failure correlation to Sales Support", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", label: "Acme - Acme evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") return json({ error: "CloudShare failed", correlationId: "corr-sales-1" }, 502);
      return json({ error: "unexpected" }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await screen.findByRole("combobox", { name: "Opportunity" });
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    const support = await screen.findByRole("button", { name: /Open support diagnostics/ }); await user.click(support);
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-sales-1");
  });

  it("keeps a successfully-created needs-attention Session non-retryable and linked to Sales Support", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", label: "Acme - Acme evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") return json({ session: { id: "session-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Rep", createdAt: "2026-07-14T15:00:00.000Z" }, needsAttention: true, correlationId: "corr-sales-created", warning: "The support audit could not be completed." }, 201);
      return json({ error: "unexpected" }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await screen.findByRole("combobox", { name: "Opportunity" });
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Needs attention: The support audit could not be completed.");
    expect(alert.textContent).toContain("Do not retry creation.");
    const support = screen.getByRole("button", { name: /Open support diagnostics \(corr-sales-created\)/ }); await user.click(support);
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-sales-created");
  });

  it("returns Item authoring to the catalogue URL so reload does not reopen the form", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      return String(input) === "/api/sales/items"
        ? json({ activeItems: [], archivedItems: [] })
        : json({ projects: [], regions: [] });
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);

    await user.click(screen.getByRole("button", { name: "Create Item" }));
    expect(await screen.findByRole("heading", { name: "Create Item" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to catalogue" }));

    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=items");
    expect(await screen.findByRole("heading", { name: "Item catalogue" })).not.toBeNull();
  });

  it("restores initial URL selection from the server query state even before client search params settle", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      opportunities: [{ id: "opportunity-1", accountId: "account-1", name: "Acme proof", status: "open", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      contacts: [{ id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog", accountId: "account-1", opportunityId: "opportunity-1" }} />);

    await screen.findByRole("row", { name: /Acme proof/ });
    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("keeps the selected Account as visible history when it is archived", async () => {
    const user = userEvent.setup();
    let archived = false;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") { archived = true; return json({ account: { id: "account-1" } }); }
      return json({ accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: archived ? "2026-07-12T17:01:00.000Z" : null, createdAt: "2026-07-12T17:00:00.000Z" }], opportunities: [], contacts: [] });
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    await screen.findByRole("row", { name: /Acme Labs/ });
    await user.click(screen.getByRole("row", { name: /Acme Labs/ }));
    mockRouter.replace.mockClear();

    await user.click(screen.getByRole("button", { name: "Archive Acme Labs" }));

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Accounts lifecycle" }) as HTMLSelectElement).value).toBe("archived"));
    expect(screen.getByRole("row", { name: /Acme Labs/ })).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/accounts/account-1/archive", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/accounts", { cache: "no-store" });
  });

  it("hides archived Accounts by default and exposes them through the explicit lifecycle filter", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [
        { id: "active-account", name: "Active Acme", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" },
        { id: "archived-account", name: "Historical Acme", kind: "prospect", archivedAt: "2026-07-11T17:00:00.000Z", createdAt: "2026-07-10T17:00:00.000Z" },
      ], opportunities: [], contacts: [],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    await screen.findByRole("row", { name: /Active Acme/ });
    expect(screen.queryByRole("row", { name: /Historical Acme/ })).toBeNull();

    await user.selectOptions(screen.getByRole("combobox", { name: "Accounts lifecycle" }), "archived");
    expect(screen.getByRole("row", { name: /Historical Acme/ })).not.toBeNull();
  });

  it("preserves an archived URL drill-down and promotes its lifecycle filters", async () => {
    mockSearchParams.set("accountId", "archived-account");
    mockSearchParams.set("opportunityId", "archived-opportunity");
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "archived-account", name: "Historical Acme", kind: "prospect", archivedAt: "2026-07-11T17:00:00.000Z", createdAt: "2026-07-10T17:00:00.000Z" }],
      opportunities: [{ id: "archived-opportunity", accountId: "archived-account", name: "Historical proof", status: "lost", archivedAt: "2026-07-11T18:00:00.000Z", createdAt: "2026-07-10T18:00:00.000Z" }],
      contacts: [{ id: "historical-contact", opportunityId: "archived-opportunity", firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test", archivedAt: null, createdAt: "2026-07-10T18:00:00.000Z" }],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Accounts lifecycle" }) as HTMLSelectElement).value).toBe("archived"));
    expect((screen.getByRole("combobox", { name: "Opportunities lifecycle" }) as HTMLSelectElement).value).toBe("archived");
    expect(screen.getByRole("row", { name: /Historical Acme/ })).not.toBeNull();
    expect(screen.getByRole("row", { name: /Historical proof/ })).not.toBeNull();
    expect(screen.getByText("Ada Lovelace")).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("closes a record dialog with Escape while retaining keyboard focus", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [], opportunities: [], contacts: [],
    }));
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    await user.click(screen.getByRole("button", { name: "New Account" }));
    expect(screen.getByRole("dialog", { name: "New Account" })).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Account name")));
    await user.keyboard("{Tab}{Tab}{Tab}{Tab}");
    expect(document.activeElement).toBe(screen.getByLabelText("Account name"));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "New Account" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New Account" }));
  });

  it("keeps disabled child creation compact and locks a new Opportunity to the selected Account", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      opportunities: [], contacts: [],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    const newOpportunity = await screen.findByRole("button", { name: "New Opportunity" });
    expect((newOpportunity as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Select an Account to add an Opportunity.")).toBeNull();

    await user.click(screen.getByRole("row", { name: /Acme Labs/ }));
    await user.click(newOpportunity);

    const dialog = screen.getByRole("dialog", { name: "New Opportunity" });
    expect(dialog).not.toBeNull();
    expect(screen.getByText("Selected Account")).not.toBeNull();
    expect(dialog.textContent).toContain("Acme Labs");
    expect(screen.queryByLabelText("Account")).toBeNull();
  });

  it("locks a new Contact to the selected Opportunity and keeps action button copy compact", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      opportunities: [{ id: "opportunity-1", accountId: "account-1", name: "Acme proof", status: "open", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      contacts: [],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    await screen.findByRole("row", { name: /Acme Labs/ });
    expect((screen.getByRole("button", { name: "New Contact" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Select an Opportunity to add a Contact.")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit Acme Labs" }).textContent).toBe("Edit");
    expect(screen.getByRole("button", { name: "Archive Acme Labs" }).textContent).toBe("Archive");

    await user.click(screen.getByRole("row", { name: /Acme Labs/ }));
    await user.click(screen.getByRole("row", { name: /Acme proof/ }));
    await user.click(screen.getByRole("button", { name: "New Contact" }));

    const dialog = screen.getByRole("dialog", { name: "New Contact" });
    expect(dialog).not.toBeNull();
    expect(screen.getByText("Selected Opportunity")).not.toBeNull();
    expect(dialog.textContent).toContain("Acme proof");
    expect(screen.queryByLabelText("Opportunity")).toBeNull();
  });

  it("keeps Space and Enter on row actions with the action instead of selecting its row", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      opportunities: [], contacts: [],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "records", itemView: "catalog" }} />);
    const edit = await screen.findByRole("button", { name: "Edit Acme Labs" });
    edit.focus();
    await user.keyboard(" ");

    expect(screen.getByRole("dialog", { name: "Edit Account" })).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");

    mockRouter.replace.mockClear();
    edit.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: "Edit Account" })).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
  it("keeps persisted Session operations visible after a fresh Sessions route and saves the selected timezone preference", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/accounts") return json({ accounts: [], opportunities: [], contacts: [] });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }, { id: "Europe/London", name: "London" }], freshness: "fresh", preference: { timeZone: "UTC", experienceType: "demo" } });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [{ id: "persisted-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "in_progress" }] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    expect((await screen.findByRole("region", { name: "Sales Enablement Session operations" })).textContent).toContain("in progress");
    const timezone = await screen.findByRole("combobox", { name: "Time zone" });
    await user.clear(timezone); await user.type(timezone, "Europe/London");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/timezones", expect.objectContaining({ method: "PUT", body: expect.stringContaining("Europe/London") })));
  });

  it("surfaces a failed reconciliation with its support correlation and defers name edits until live full-PUT compatibility is proven", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "persisted-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "ended", verificationEligible: true }] });
      if (path === "/api/sales/enablement-sessions/persisted-1/reconcile" && init?.method === "POST") return json({ error: "CloudShare could not reconcile this Sales Session.", correlationId: "corr-reconcile-1" }, 502);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await screen.findByText(/persisted-1|DEMO/);
    expect(screen.queryByRole("button", { name: "Edit name" })).toBeNull();

    expect(screen.getByText(/Verify CloudShare status reads the persisted Sales Experience/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Verify CloudShare status" }));

    expect((await screen.findByRole("alert")).textContent).toContain("CloudShare could not reconcile this Sales Session.");
    const support = screen.getByRole("button", { name: "Open support diagnostics (corr-reconcile-1)" });
    await user.click(support);
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-reconcile-1");
  });

  it("places each Session action group before its descriptive session text", async () => {
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "aligned-session", opportunityId: "opp-1", itemId: "item-1", type: "demo", sessionName: "Aligned Session", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "upcoming", verificationEligible: true }] });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);

    const actions = await screen.findByRole("group", { name: "Session actions for Aligned Session, revision 1" });
    const description = screen.getByText(/Aligned Session.*2026-08-15T08:00/);
    expect(actions.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.textContent).toContain("Verify CloudShare status");
    expect(actions.textContent).toContain("Manage participants");
  });

  it("explains why CloudShare verification is unavailable for provisioning and needs-attention Sessions", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "provisioning-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "provisioning", verificationEligible: false }, { id: "attention-1", opportunityId: "opp-2", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "needs_attention", verificationEligible: false }] });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    expect(await screen.findAllByText("CloudShare verification is unavailable while this session is provisioning or needs attention.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Verify CloudShare status" })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/reconcile"))).toBe(false);
  });

  it("confirms a CloudShare status verification without claiming that the scheduled lifecycle changed", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "persisted-verified", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "ended", verificationEligible: true }] });
      if (path === "/api/sales/enablement-sessions/persisted-verified/reconcile" && init?.method === "POST") return json({ correlationId: "corr-verified-1", operationalStatus: "active" });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await user.click(await screen.findByRole("button", { name: "Verify CloudShare status" }));
    expect((await screen.findByText("CloudShare status verified. The scheduled lifecycle is unchanged.")).textContent).toContain("CloudShare status verified. The scheduled lifecycle is unchanged.");
    expect(screen.getByRole("button", { name: "Open support diagnostics (corr-verified-1)" })).not.toBeNull();
  });

  it("parses a failed eligible name edit and links its correlation to Sales Support", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "eligible-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", lifecycle: "upcoming", editEligible: true }] });
      if (path === "/api/sales/enablement-sessions/eligible-1" && init?.method === "PUT") return json({ error: "CloudShare rejected the Sales Session update.", correlationId: "corr-edit-1" }, 502);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await screen.findByRole("button", { name: "Edit name" });
    await user.click(screen.getByRole("button", { name: "Edit name" }));
    const nameInput = screen.getByRole("textbox", { name: "Session name" });
    const saveEdit = screen.getByRole("button", { name: "Save edit" });
    expect(nameInput.compareDocumentPosition(saveEdit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit name" })).toBeNull();
    await user.click(saveEdit);
    expect((await screen.findByRole("alert")).textContent).toContain("CloudShare rejected the Sales Session update.");
    await user.click(screen.getByRole("button", { name: "Open support diagnostics (corr-edit-1)" }));
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-edit-1");
  });

  it("restores the Sessions Account and Opportunity from the route without loading the records catalogue", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme - International" }], opportunities: [{ id: "opp-1", accountId: "account-1", accountName: "Acme - International", name: "Proof - Phase 1", label: "Acme - International - Proof - Phase 1" }], total: 1, nextRevision: 3 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [], policy: { id: "policy-1", name: "Policy" }, regions: [], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      if (path === "/api/sales/timezones") return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", accountId: "account-1", opportunityId: "opp-1" }} />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("Acme - International"));
    expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLInputElement).value).toBe("Acme - International - Proof - Phase 1");
    await waitFor(() => expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("Acme - International - Proof - Phase 1 (3) - Item"));
    const template = screen.getByRole("textbox", { name: "Session name template" });
    fireEvent.change(template, { target: { value: "{opportunity} :: {account}" } });
    expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("Template must include {revision}");
    expect(screen.getByText(/Use \{account\}, \{opportunity\}, \{revision\}, and \{item\}/)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Save as default template" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save as default template" }) as HTMLButtonElement).style.justifySelf).toBe("start");
    fireEvent.change(template, { target: { value: "{opportunity} :: {owner} ({revision})" } });
    expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("supported placeholders");
    expect((screen.getByRole("button", { name: "Create Sales Enablement Session" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sales/accounts", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("selectedOpportunityId=opp-1"),
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("restores same-tab history filters without discarding an unfinished Session form", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }, { id: "account-2", name: "Brio" }], opportunities: [{ id: "opp-1", accountId: "account-1", accountName: "Acme", name: "North", label: "Acme - North" }, { id: "opp-2", accountId: "account-2", accountName: "Brio", name: "South", label: "Brio - South" }], total: 2, nextRevision: 2 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    const view = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", accountId: "account-1", opportunityId: "opp-1" }} />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("Acme"));
    const template = screen.getByRole("textbox", { name: "Session name template" }) as HTMLInputElement;
    fireEvent.change(template, { target: { value: "Draft {account} - {opportunity} ({revision})" } });

    view.rerender(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", accountId: "account-2", opportunityId: "opp-2" }} />);

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("Brio"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLInputElement).value).toBe("Brio - South"));
    expect(template.value).toBe("Draft {account} - {opportunity} ({revision})");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("selectedOpportunityId=opp-2"), expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("registers named Opportunity Contacts without sending mail, then sends a selected native invite without exposing provider identifiers", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    let participantReads = 0;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "session-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-17T00:00:00Z", lifecycle: "upcoming", verificationEligible: true }] });
      if (path === "/api/sales/accounts") return json({ contacts: [{ id: "contact-1", opportunityId: "opp-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null, createdAt: "2026-07-17T00:00:00Z" }] });
      if (path === "/api/sales/enablement-sessions/session-1/participants" && !init?.method) { participantReads += 1; return participantReads === 2 ? json({ error: "Monitoring temporarily unavailable" }, 502) : json({ participants: [], correlationId: "corr-read-1" }); }
      if (path === "/api/sales/enablement-sessions/session-1/participants" && init?.method === "POST") return json({ participants: [{ id: "portal-participant-1", opportunityContactId: "contact-1", firstName: "Ada", lastName: "Lovelace", invitationStatus: "notSent", invitedBy: null, participationStatus: "pending", firstJoined: null, envStatus: null }], correlationId: "corr-register-1" }, 201);
      if (path === "/api/sales/enablement-sessions/session-1/participants/invite" && init?.method === "POST") return json({ correlationId: "corr-invite-1" });
      if (path === "/api/sales/enablement-sessions/session-1/participants/portal-participant-1/launch-link" && init?.method === "POST") return json({ launchUrl: "/sales/launch/opaque-certalis-token", correlationId: "corr-launch-1" }, 201);
      if (path === "/api/sales/enablement-sessions/session-1/participants/portal-participant-1/launch-link" && init?.method === "DELETE") return json({ correlationId: "corr-revoke-1" });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions" }} />);
    await user.click(await screen.findByRole("button", { name: "Manage participants" }));
    await user.click(await screen.findByLabelText(/Ada Lovelace$/));
    await user.click(screen.getByRole("button", { name: "Register or repair selected participants" }));
    expect(await screen.findByText("Sales Participants registered. No native invitations were sent.")).not.toBeNull();
    expect(screen.queryByLabelText(/^Ada Lovelace$/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions/session-1/participants", expect.objectContaining({ method: "POST", body: JSON.stringify({ contactIds: ["contact-1"] }) }));
    expect(screen.queryByText("cloudshare-participant-1")).toBeNull();
    await user.click(screen.getByLabelText("Select Ada Lovelace for native invite"));
    await user.click(screen.getByRole("button", { name: "Send or resend native invites" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions/session-1/participants/invite", expect.objectContaining({ method: "POST", body: JSON.stringify({ participantIds: ["portal-participant-1"] }) }));
    expect(await screen.findByText("Native CloudShare invitations were requested. Participant monitoring could not refresh; investigate the invite evidence before retrying.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open support diagnostics for latest participant operation (corr-invite-1)" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy launch link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/sales/launch/opaque-certalis-token")));
    expect(screen.queryByText("cloudshare.example")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions/session-1/participants/portal-participant-1/launch-link", expect.objectContaining({ method: "DELETE" }));
  });
});
