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

    expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=records&accountId=account-1");
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Opportunity" }), "opp-1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1");
    const end = screen.getByLabelText("End") as HTMLInputElement;
    await waitFor(() => expect(end.value).not.toBe(""));
    fireEvent.change(end, { target: { value: "2026-07-17T10:15" } });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    await screen.findByText("Sales Enablement Session created. No invitations were sent.");
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions", expect.objectContaining({ method: "POST", body: expect.stringContaining('"end":"2026-07-17T10:15"') }));
    expect(consoleError).not.toHaveBeenCalled();
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Opportunity" }), "opp-1"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
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
    await user.selectOptions(screen.getByRole("combobox", { name: "Opportunity" }), "opp-1"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
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
    const timezone = await screen.findByRole("combobox", { name: "CloudShare time zone" });
    await user.clear(timezone); await user.type(timezone, "Europe/London");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/timezones", expect.objectContaining({ method: "PUT", body: expect.stringContaining("Europe/London") })));
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
    expect((await screen.findByRole("combobox", { name: "Session Account" }) as HTMLSelectElement).value).toBe("account-1");
    expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLSelectElement).value).toBe("opp-1");
    await waitFor(() => expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("Acme - International - Proof - Phase 1 (3) - Item"));
    const template = screen.getByRole("textbox", { name: "Session name template" });
    fireEvent.change(template, { target: { value: "{opportunity} :: {account}" } });
    expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("Template must include {revision}");
    expect((screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(template, { target: { value: "{opportunity} :: {owner} ({revision})" } });
    expect(screen.getByRole("status", { name: "Session name preview" }).textContent).toContain("supported placeholders");
    expect((screen.getByRole("button", { name: "Create Sales Enablement Session" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sales/accounts", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("selectedOpportunityId=opp-1"), { cache: "no-store" });
  });
});
