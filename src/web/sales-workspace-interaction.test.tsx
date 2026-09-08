/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";
import { salesSessionProvisionDraftKey } from "./sales-session-provision-draft";

vi.mock("./session-expiry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-expiry")>()),
  startPortalSessionWatchdog: () => ({ checkNow: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));

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
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.sessionStorage.clear(); mockSearchParams.delete("accountId"); mockSearchParams.delete("opportunityId"); mockRouter.push.mockClear(); mockRouter.replace.mockClear(); window.history.replaceState({}, "", "/sales"); });

  it("renders the Sessions queue immediately when navigating from another workspace section", () => {
    vi.spyOn(window, "fetch").mockImplementation(() => new Promise<Response>(() => undefined));
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "support", itemView: "catalog" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));

    expect(screen.getByRole("heading", { name: "Sessions" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Manage Sales Enablement Sessions" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Sales workspace navigation" })).not.toBeNull();
    expect(screen.getAllByText("Sales workspace")).toHaveLength(2);
    expect(screen.getByText("sales-admin@certalis.demo")).not.toBeNull();
    expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=sessions");
  });

  it("selects an Account into the URL and limits the next grid to its Opportunities without console errors", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
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
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=sessions&opportunityId=opp-1&sessionId=session-1"));
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
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
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions&opportunityId=opp-north&view=provision", { scroll: false });
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);

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
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions&view=provision", { scroll: false });
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);

    const account = await screen.findByRole("combobox", { name: "Account" });
    await user.click(account);
    await screen.findByRole("option", { name: "Acme" });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions&accountId=account-1&view=provision", { scroll: false });
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await user.click(await screen.findByRole("combobox", { name: "Opportunity" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Active Sales records are temporarily unavailable.");
  });

  it("keeps browser-filled Trial Offering datetimes in the POST payload so draft creation succeeds", async () => {
    const user = userEvent.setup();
    const postBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items" && !init?.method) {
        return json({
          activeItems: [{
            id: "item-1",
            name: "Accelerate Trial",
            description: "",
            project: { id: "project-1", name: "Project" },
            blueprints: [{ id: "bp-1", name: "Blueprint" }],
            policy: { id: "policy-1", name: "Policy" },
            regions: [{ id: "region-1", name: "Region" }],
            defaultDurationMinutes: 1440,
            status: "active",
          }],
        });
      }
      if (path === "/api/sales/timezones" && !init?.method) {
        return json({ timezones: [{ id: "UTC", name: "UTC" }] });
      }
      if (path === "/api/sales/enablement-sessions/project-members?itemId=item-1") {
        return json({ members: [{ email: "owner@example.test", displayName: "Owner Example" }] });
      }
      if (path === "/api/sales/trial-offerings" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        if (body.start === "2026-09-01T09:00" && body.end === "2026-09-01T17:00") {
          return json({
            offering: {
              id: "offering-1",
              title: body.title,
              description: body.description,
              itemId: body.itemId,
              start: body.start,
              end: body.end,
              timeZone: body.timeZone,
              salesProEmail: body.salesProEmail,
              salesProDisplayName: "Owner Example",
              status: "draft",
              attentionReason: null,
            },
          }, 201);
        }
        return json({ error: "Invalid Sales Trial Offering request." }, 400);
      }
      if (path === "/api/sales/trial-offerings" && !init?.method) {
        return json({ offerings: [] });
      }
      return json({});
    });

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "trial-offerings" }} />);

    await user.type(await screen.findByLabelText("Title"), "Helios Trial");
    await user.type(screen.getByLabelText("Description"), "Shared trial");
    await user.selectOptions(screen.getByLabelText("Item"), "item-1");
    await user.selectOptions(await screen.findByLabelText("Sales Pro"), "owner@example.test");

    const start = screen.getByLabelText("Start") as HTMLInputElement;
    const end = screen.getByLabelText("End") as HTMLInputElement;
    start.value = "2026-09-01T09:00";
    end.value = "2026-09-01T17:00";

    expect(start.value).toBe("2026-09-01T09:00");
    expect(end.value).toBe("2026-09-01T17:00");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(postBodies).toEqual([{
        title: "Helios Trial",
        description: "Shared trial",
        itemId: "item-1",
        start: "2026-09-01T09:00",
        end: "2026-09-01T17:00",
        noEndDate: false,
        timeZone: "UTC",
        salesProEmail: "owner@example.test",
      }]);
    });
    expect((await screen.findByRole("status")).textContent).toContain("Trial Offering draft saved.");
  });

  it("sends an intentionally cleared Trial Offering datetime as an empty string instead of restoring stale state", async () => {
    const user = userEvent.setup();
    const postBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items" && !init?.method) {
        return json({
          activeItems: [{
            id: "item-1",
            name: "Accelerate Trial",
            description: "",
            project: { id: "project-1", name: "Project" },
            blueprints: [{ id: "bp-1", name: "Blueprint" }],
            policy: { id: "policy-1", name: "Policy" },
            regions: [{ id: "region-1", name: "Region" }],
            defaultDurationMinutes: 1440,
            status: "active",
          }],
        });
      }
      if (path === "/api/sales/timezones" && !init?.method) {
        return json({ timezones: [{ id: "UTC", name: "UTC" }] });
      }
      if (path === "/api/sales/enablement-sessions/project-members?itemId=item-1") {
        return json({ members: [{ email: "owner@example.test", displayName: "Owner Example" }] });
      }
      if (path === "/api/sales/trial-offerings" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        return json({ error: "Invalid Sales Trial Offering request." }, 400);
      }
      if (path === "/api/sales/trial-offerings" && !init?.method) {
        return json({ offerings: [] });
      }
      return json({});
    });

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "trial-offerings" }} />);

    await user.type(await screen.findByLabelText("Title"), "Helios Trial");
    await user.type(screen.getByLabelText("Description"), "Shared trial");
    await user.selectOptions(screen.getByLabelText("Item"), "item-1");
    await user.selectOptions(await screen.findByLabelText("Sales Pro"), "owner@example.test");

    const start = screen.getByLabelText("Start") as HTMLInputElement;
    const end = screen.getByLabelText("End") as HTMLInputElement;
    fireEvent.input(start, { target: { value: "2026-09-01T09:00" } });
    fireEvent.input(end, { target: { value: "2026-09-01T17:00" } });
    await waitFor(() => {
      expect(start.value).toBe("2026-09-01T09:00");
      expect(end.value).toBe("2026-09-01T17:00");
    });

    start.value = "";
    fireEvent.input(start, { target: { value: "" } });
    expect(start.value).toBe("");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(postBodies).toEqual([{
        title: "Helios Trial",
        description: "Shared trial",
        itemId: "item-1",
        start: "",
        end: "2026-09-01T17:00",
        noEndDate: false,
        timeZone: "UTC",
        salesProEmail: "owner@example.test",
      }]);
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid Sales Trial Offering request.");
  });

  it("retries Trial Offering draft save with the current visible form values after a failed attempt and selection changes", async () => {
    const user = userEvent.setup();
    const postBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items" && !init?.method) {
        return json({
          activeItems: [{
            id: "item-1",
            name: "Windows Boxes",
            description: "",
            project: { id: "project-1", name: "Project" },
            blueprints: [{ id: "bp-1", name: "Blueprint" }],
            policy: { id: "policy-1", name: "Policy" },
            regions: [{ id: "region-1", name: "Region" }],
            defaultDurationMinutes: 1440,
            status: "active",
          }],
        });
      }
      if (path === "/api/sales/timezones" && !init?.method) {
        return json({
          timezones: [
            { id: "UTC", name: "UTC" },
            { id: "Europe/London", name: "Europe/London" },
          ],
        });
      }
      if (path === "/api/sales/enablement-sessions/project-members?itemId=item-1") {
        return json({
          members: [
            { email: "first-owner@example.test", displayName: "First Owner" },
            { email: "sales-pro@example.test", displayName: "Sales Pro" },
          ],
        });
      }
      if (path === "/api/sales/trial-offerings" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        postBodies.push(body);
        if (postBodies.length === 1) {
          return json({ error: "Invalid Sales Trial Offering request." }, 400);
        }
        return json({
          offering: {
            id: "offering-1",
            title: body.title,
            description: body.description,
            itemId: body.itemId,
            start: body.start,
            end: body.end,
            timeZone: body.timeZone,
            salesProEmail: body.salesProEmail,
            salesProDisplayName: "Sales Pro",
            status: "draft",
            attentionReason: null,
          },
        }, 201);
      }
      if (path === "/api/sales/trial-offerings" && !init?.method) {
        return json({ offerings: [] });
      }
      return json({});
    });

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "trial-offerings" }} />);

    await user.type(await screen.findByLabelText("Title"), "Helios Trial");
    await user.type(screen.getByLabelText("Description"), "Shared trial");
    await user.selectOptions(screen.getByLabelText("Item"), "item-1");
    await user.selectOptions(await screen.findByLabelText("Sales Pro"), "first-owner@example.test");

    const start = screen.getByLabelText("Start") as HTMLInputElement;
    const end = screen.getByLabelText("End") as HTMLInputElement;
    const timeZone = screen.getByDisplayValue("UTC") as HTMLInputElement;
    const salesPro = screen.getByLabelText("Sales Pro") as HTMLSelectElement;

    fireEvent.input(start, { target: { value: "2026-08-30T18:59" } });
    fireEvent.input(end, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid Sales Trial Offering request.");

    start.value = "2026-08-30T18:59";
    end.value = "2026-08-30T19:54";
    timeZone.value = "Europe/London";
    salesPro.value = "sales-pro@example.test";

    expect(start.value).toBe("2026-08-30T18:59");
    expect(end.value).toBe("2026-08-30T19:54");
    expect(timeZone.value).toBe("Europe/London");
    expect(salesPro.value).toBe("sales-pro@example.test");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(postBodies).toEqual([
        {
          title: "Helios Trial",
          description: "Shared trial",
          itemId: "item-1",
          start: "2026-08-30T18:59",
          end: "",
          noEndDate: false,
          timeZone: "UTC",
          salesProEmail: "first-owner@example.test",
        },
        {
          title: "Helios Trial",
          description: "Shared trial",
          itemId: "item-1",
          start: "2026-08-30T18:59",
          end: "2026-08-30T19:54",
          noEndDate: false,
          timeZone: "Europe/London",
          salesProEmail: "sales-pro@example.test",
        },
      ]);
    });
    expect((await screen.findByRole("status")).textContent).toContain("Trial Offering draft saved.");
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await screen.findByRole("combobox", { name: "Opportunity" });
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    const support = await screen.findByRole("button", { name: /Open support diagnostics/ }); await user.click(support);
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-sales-1");
  });

  it("opens Trial Offering attention diagnostics with source and subject filters immediately", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones") return json({ timezones: [] });
      if (path === "/api/sales/trial-offerings") {
        return json({
          offerings: [
            {
              id: "offering-1",
              title: "Windows Trial",
              description: "",
              itemId: "item-1",
              start: "2026-08-30T09:00",
              end: null,
              timeZone: "UTC",
              salesProEmail: "owner@example.test",
              salesProDisplayName: "Owner Example",
              status: "published",
              attentionReason:
                "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
            },
          ],
        });
      }
      if (path.startsWith("/api/sales/diagnostics?")) {
        return json({
          entries: [],
          page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null },
        });
      }
      return json({ error: `Unexpected request ${path}` }, 500);
    });

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "trial-offerings" }} />);

    await user.click(await screen.findByRole("button", { name: "Open support diagnostics" }));

    expect(mockRouter.push).toHaveBeenLastCalledWith(
      "/sales?tab=support&source=sales-trial-offerings&subjectId=offering-1",
    );
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), "http://localhost:3000");
        return url.pathname === "/api/sales/diagnostics" &&
          url.searchParams.get("source") === "sales-trial-offerings" &&
          url.searchParams.get("subjectId") === "offering-1";
      })).toBe(true);
    });
  });

  it("composes workflow evidence navigation with canonical subject filters and reacts to type-only route changes", async () => {
    const user = userEvent.setup();
    const diagnosticsRequests: URL[] = [];
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/sales/items") return json({ activeItems: [] });
      if (url.pathname === "/api/sales/timezones") return json({ timezones: [] });
      if (url.pathname === "/api/sales/trial-offerings") {
        return json({ offerings: [{ id: "same-id", title: "Windows Trial", description: "", itemId: "item-1", start: "2026-08-30T09:00", end: null, timeZone: "UTC", salesProEmail: "owner@example.test", salesProDisplayName: "Owner Example", status: "published", attentionReason: null }] });
      }
      if (url.pathname === "/api/sales/diagnostics") {
        diagnosticsRequests.push(url);
        return json({ entries: [], page: { limit: 50, offset: 0, returned: 0, hasMore: false, nextOffset: null } });
      }
      return json({ error: `Unexpected request ${url.pathname}` }, 500);
    });

    const view = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "trial-offerings" }} />);
    await user.click(await screen.findByRole("button", { name: "View workflow evidence" }));
    await waitFor(() => expect(diagnosticsRequests.at(-1)?.searchParams.get("subjectType")).toBe("sales_trial_offering"));
    expect(diagnosticsRequests.at(-1)?.searchParams.get("subjectId")).toBe("same-id");
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&subjectType=sales_trial_offering&subjectId=same-id");

    view.rerender(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "support", subjectType: "sales_trial_enrollment", subjectId: "same-id" }} />);
    await waitFor(() => expect(diagnosticsRequests.at(-1)?.searchParams.get("subjectType")).toBe("sales_trial_enrollment"));
    expect(diagnosticsRequests.at(-1)?.searchParams.get("subjectId")).toBe("same-id");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("keeps a successfully-created needs-attention Session non-retryable and linked to Sales Support", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", label: "Acme - Acme evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") return json({ session: { id: "session-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Rep", createdAt: "2026-07-14T15:00:00.000Z" }, needsAttention: true, correlationId: "corr-sales-created", warning: "The support audit could not be completed.", creationOutcome: { dimension: "certalis_creation", value: "needs_attention", source: "certalis_support_persistence", retry: "unsafe_requires_support", reason: "The support audit could not be completed.", sessionId: "session-1" } }, 201);
      return json({ error: "unexpected" }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await screen.findByRole("combobox", { name: "Opportunity" });
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=sessions&opportunityId=opp-1&sessionId=session-1&status=needs_attention&queue=needs_attention"));
    expect(screen.queryByRole("combobox", { name: "Operational view" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sessions" })).not.toBeNull();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Needs attention: The support audit could not be completed.");
    expect(alert.textContent).toContain("Do not retry creation.");
    const support = screen.getByRole("button", { name: /Open support diagnostics \(corr-sales-created\)/ }); await user.click(support);
    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=support&correlationId=corr-sales-created");
  });

  it("blocks generic retry when CloudShare creation has an ambiguous POST outcome", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", label: "Acme - Acme evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") return json({ error: "CloudShare POST /sales completed without a response, so the creation outcome is unknown. Do not retry creation; review support diagnostics.", needsAttention: true, correlationId: "corr-ambiguous", creationOutcome: { dimension: "certalis_creation", value: "needs_attention", source: "cloudshare_v4_post_sales_ambiguous", retry: "unsafe_requires_support", reason: "CloudShare POST /sales completed without a response, so the creation outcome is unknown.", sessionId: "session-ambiguous" } }, 502);
      return json({ error: "unexpected" }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");

    const create = screen.getByRole("button", { name: "Create Sales Enablement Session" });
    await user.click(create);

    expect((await screen.findByRole("alert")).textContent).toContain("outcome is unknown");
    expect((screen.getByRole("button", { name: "Create Sales Enablement Session" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input) === "/api/sales/enablement-sessions" && init?.method === "POST")).toHaveLength(1);
    expect(mockRouter.push).not.toHaveBeenCalledWith(expect.stringContaining("view=manage"));
  });

  it("keeps Create enabled after a safe pre-write 503 so the next POST can succeed", async () => {
    const user = userEvent.setup(); let attempts = 0;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", label: "Acme - Acme evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [{ id: "bp-1", name: "Blueprint" }], policy: { id: "policy-1", name: "Policy" }, regions: [{ id: "region-1", name: "Region" }], salesExperienceType: "demo", defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "qa-sales-admin@certalis.test", displayName: "QA Sales Admin" }] });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) return json({ error: "CloudShare authentication failed before creation. Retry the Sales Enablement Session.", needsAttention: false, correlationId: "corr-safe-503", creationOutcome: { dimension: "certalis_creation", value: "not_created", source: "certalis_pre_dispatch", retry: "safe", reason: "OAuth failed before POST /sales" } }, 503);
        return json({ session: { id: "session-retry", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T09:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Rep", createdAt: "2026-07-14T15:00:00.000Z" } }, 201);
      }
      return json({ error: "unexpected" }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await chooseSearchableOption(user, "Opportunity", "Acme - Acme evaluation"); await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1"); await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "qa-sales-admin@certalis.test");
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));
    await screen.findByRole("alert");
    const retry = screen.getByRole("button", { name: "Create Sales Enablement Session" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    await user.click(retry);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=sessions&opportunityId=opp-1&sessionId=session-retry&status=in_progress"));
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input) === "/api/sales/enablement-sessions" && init?.method === "POST")).toHaveLength(2);
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
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [{ id: "persisted-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: true }] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);
    expect((await screen.findByRole("region", { name: "Sales Enablement Session operations" })).textContent).toContain("CloudShare Sales Experience: inProgress");
    await user.click(screen.getByRole("button", { name: "Provision" }));
    const timezone = await screen.findByRole("combobox", { name: "Time zone" });
    await user.clear(timezone); await user.type(timezone, "Europe/London");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/timezones", expect.objectContaining({ method: "PUT", body: expect.stringContaining("Europe/London") })));
  });

  it("keeps a stale timezone response's saved preferences and never persists the UTC/demo defaults", async () => {
    const preferenceWrites: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }, { id: "Europe/London", name: "London" }], freshness: "stale", warning: "CloudShare could not refresh timezones; showing the last verified catalogue.", correlationId: "corr-stale-timezones", preference: { timeZone: "Europe/London", experienceType: "poc" } });
      if (path === "/api/sales/timezones" && init?.method === "PUT") { preferenceWrites.push(String(init.body)); return new Response(null, { status: 204 }); }
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path === "/api/sales/session-configuration") return json({});
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Time zone" }) as HTMLInputElement).value).toBe("Europe/London"));
    expect(preferenceWrites).toEqual([]);
    expect((screen.getByRole("combobox", { name: "Time zone" }) as HTMLInputElement).value).toBe("Europe/London");
    expect((screen.getByRole("combobox", { name: "Sales Experience type" }) as HTMLSelectElement).value).toBe("poc");
    expect(screen.getByText(/time-zone list is temporarily cached/).textContent).toContain("temporarily cached");
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/timezones", expect.objectContaining({ cache: "no-store" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sales Experience type" }), { target: { value: "pov" } });
    await waitFor(() => expect(preferenceWrites).toEqual([JSON.stringify({ timeZone: "Europe/London", experienceType: "pov" })]));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not persist defaults while a stale timezone response has no saved preference", async () => {
    const preferenceWrites: string[] = [];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], freshness: "stale", warning: "CloudShare could not refresh timezones; showing the last verified catalogue.", preference: { timeZone: null, experienceType: null } });
      if (path === "/api/sales/timezones" && init?.method === "PUT") { preferenceWrites.push(String(init.body)); return new Response(null, { status: 204 }); }
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path === "/api/sales/session-configuration") return json({});
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await waitFor(() => expect(screen.getByText(/time-zone list is temporarily cached/)).not.toBeNull());
    expect(preferenceWrites).toEqual([]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sales Experience type" }), { target: { value: "poc" } });
    await waitFor(() => expect(preferenceWrites).toEqual([JSON.stringify({ timeZone: "UTC", experienceType: "poc" })]));
  });

  it("keeps an in-flight Sales Admin edit when the timezone preference response arrives late", async () => {
    const preferenceWrites: string[] = [];
    let resolveTimezones: ((response: Response) => void) | undefined;
    vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const path = String(input);
      if (path === "/api/sales/timezones" && !init?.method) return new Promise<Response>((resolve) => { resolveTimezones = resolve; });
      if (path === "/api/sales/timezones" && init?.method === "PUT") { preferenceWrites.push(String(init.body)); return Promise.resolve(new Response(null, { status: 204 })); }
      if (path === "/api/sales/items") return Promise.resolve(json({ activeItems: [] }));
      if (path.startsWith("/api/sales/enablement-sessions?")) return Promise.resolve(json({ sessions: [] }));
      if (path.startsWith("/api/sales/session-opportunities?")) return Promise.resolve(json({ accounts: [], opportunities: [], total: 0 }));
      if (path === "/api/sales/session-configuration") return Promise.resolve(json({}));
      return Promise.resolve(json({ error: `Unexpected request ${path}` }, 500));
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await waitFor(() => expect(resolveTimezones).toBeDefined());
    fireEvent.change(screen.getByRole("combobox", { name: "Time zone" }), { target: { value: "America/New_York" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sales Experience type" }), { target: { value: "pov" } });
    resolveTimezones?.(json({ timezones: [{ id: "UTC", name: "UTC" }, { id: "Europe/London", name: "London" }, { id: "America/New_York", name: "New York" }], freshness: "live", preference: { timeZone: "Europe/London", experienceType: "poc" } }));
    await waitFor(() => expect(preferenceWrites).toEqual([JSON.stringify({ timeZone: "America/New_York", experienceType: "pov" })]));
    expect((screen.getByRole("combobox", { name: "Time zone" }) as HTMLInputElement).value).toBe("America/New_York");
    expect((screen.getByRole("combobox", { name: "Sales Experience type" }) as HTMLSelectElement).value).toBe("pov");
  });

  it.each([
    { editedControl: "Time zone", editedValue: "America/New_York", expected: { timeZone: "America/New_York", experienceType: "poc" } },
    { editedControl: "Sales Experience type", editedValue: "pov", expected: { timeZone: "Europe/London", experienceType: "pov" } },
  ])("merges a late saved preference with an in-flight $editedControl edit", async ({ editedControl, editedValue, expected }) => {
    const preferenceWrites: string[] = [];
    let resolveTimezones: ((response: Response) => void) | undefined;
    vi.spyOn(window, "fetch").mockImplementation((input, init) => {
      const path = String(input);
      if (path === "/api/sales/timezones" && !init?.method) return new Promise<Response>((resolve) => { resolveTimezones = resolve; });
      if (path === "/api/sales/timezones" && init?.method === "PUT") { preferenceWrites.push(String(init.body)); return Promise.resolve(new Response(null, { status: 204 })); }
      if (path === "/api/sales/items") return Promise.resolve(json({ activeItems: [] }));
      if (path.startsWith("/api/sales/enablement-sessions?")) return Promise.resolve(json({ sessions: [] }));
      if (path.startsWith("/api/sales/session-opportunities?")) return Promise.resolve(json({ accounts: [], opportunities: [], total: 0 }));
      if (path === "/api/sales/session-configuration") return Promise.resolve(json({}));
      return Promise.resolve(json({ error: `Unexpected request ${path}` }, 500));
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await waitFor(() => expect(resolveTimezones).toBeDefined());
    fireEvent.change(screen.getByRole("combobox", { name: editedControl }), { target: { value: editedValue } });
    resolveTimezones?.(json({ timezones: [{ id: "UTC", name: "UTC" }, { id: "Europe/London", name: "London" }, { id: "America/New_York", name: "New York" }], freshness: "live", preference: { timeZone: "Europe/London", experienceType: "poc" } }));
    await waitFor(() => expect(preferenceWrites).toEqual([JSON.stringify(expected)]));
    expect((screen.getByRole("combobox", { name: "Time zone" }) as HTMLInputElement).value).toBe(expected.timeZone);
    expect((screen.getByRole("combobox", { name: "Sales Experience type" }) as HTMLSelectElement).value).toBe(expected.experienceType);
  });

  it("surfaces a failed reconciliation with its support correlation and defers name edits until live full-PUT compatibility is proven", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "persisted-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "ended", source: "cloudshare_v4_get_sales", freshness: "fresh" }, verificationEligible: true }] });
      if (path === "/api/sales/enablement-sessions/persisted-1/reconcile" && init?.method === "POST") return json({ error: "CloudShare could not reconcile this Sales Session.", correlationId: "corr-reconcile-1" }, 502);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);
    await screen.findByText(/persisted-1|DEMO/);
    expect(screen.queryByRole("button", { name: "Edit name" })).toBeNull();

    expect(screen.getByText(/Experience status is CloudShare when a fresh documented read exists/)).not.toBeNull();
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
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "aligned-session", opportunityId: "opp-1", itemId: "item-1", type: "demo", sessionName: "Aligned Session", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "notStarted", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: true }] });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);

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
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "provisioning-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "provisioning", source: "certalis_persistence", retry: "in_progress" }, experience: { dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: false }, { id: "attention-1", opportunityId: "opp-2", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "needs_attention", source: "certalis_persistence", retry: "unsafe_requires_support" }, experience: { dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: false }] });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);
    expect(await screen.findAllByText("CloudShare verification is unavailable while this session is provisioning or needs attention.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Verify CloudShare status" })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/reconcile"))).toBe(false);
  });

  it("confirms a CloudShare Experience status verification and keeps its support correlation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "persisted-verified", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-15T08:00", end: "2026-07-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "ended", source: "cloudshare_v4_get_sales", freshness: "fresh" }, verificationEligible: true }] });
      if (path === "/api/sales/enablement-sessions/persisted-verified/reconcile" && init?.method === "POST") return json({ correlationId: "corr-verified-1", operationalStatus: "active" });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);
    await user.click(await screen.findByRole("button", { name: "Verify CloudShare status" }));
    expect((await screen.findByText("CloudShare Experience status verified and saved.")).textContent).toContain("CloudShare Experience status verified and saved.");
    expect(screen.getByRole("button", { name: "Open support diagnostics (corr-verified-1)" })).not.toBeNull();
  });

  it("parses a failed eligible name edit and links its correlation to Sales Support", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "eligible-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "notStarted", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: true, editEligible: true }] });
      if (path === "/api/sales/enablement-sessions/eligible-1" && init?.method === "PUT") return json({ error: "CloudShare rejected the Sales Session update.", correlationId: "corr-edit-1" }, 502);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);
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
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision", accountId: "account-1", opportunityId: "opp-1" }} />);
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
    const view = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision", accountId: "account-1", opportunityId: "opp-1" }} />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("Acme"));
    const template = screen.getByRole("textbox", { name: "Session name template" }) as HTMLInputElement;
    fireEvent.change(template, { target: { value: "Draft {account} - {opportunity} ({revision})" } });

    view.rerender(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision", accountId: "account-2", opportunityId: "opp-2" }} />);

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("Brio"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLInputElement).value).toBe("Brio - South"));
    expect(template.value).toBe("Draft {account} - {opportunity} ({revision})");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("selectedOpportunityId=opp-2"), expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("routes a start-now create directly to the canonical Active queue without a legacy Manage render", async () => {
    const user = userEvent.setup(); let created = false;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    const createdSession = { id: "session-now", opportunityId: "opp-1", itemId: "item-1", type: "demo" as const, sessionName: "Acme live demo", start: "2026-07-19T18:00", end: "2026-07-19T19:00", timeZone: "UTC", salesProDisplayName: "Sales Rep", createdAt: "2026-07-19T18:00:00.000Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: true };
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", accountName: "Acme", name: "Live demo", label: "Acme - Live demo" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [], policy: { id: "policy-1", name: "Policy" }, regions: [], defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return path.includes("queue=1")
        ? json({ view: "active", offset: 0, limit: 25, total: created ? 1 : 0, rows: created ? [{ id: createdSession.id, accountId: "account-1", accountName: "Acme", opportunityId: "opp-1", opportunityName: "Live demo", sessionName: createdSession.sessionName, revision: 1, start: createdSession.start, end: createdSession.end, timeZone: "UTC", operation: createdSession.operation, experience: createdSession.experience }] : [], target: created ? { id: createdSession.id, state: "available" } : undefined })
        : json({ sessions: [] });
      if (path === "/api/sales/enablement-sessions" && init?.method === "POST") { created = true; return json({ session: createdSession }, 201); }
      if (path === "/api/sales/session-configuration") return json({});
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await chooseSearchableOption(user, "Opportunity", "Acme - Live demo");
    await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await waitFor(() => expect(window.sessionStorage.getItem(salesSessionProvisionDraftKey("sales-admin@certalis.demo"))).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Create Sales Enablement Session" }));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/sales?tab=sessions&opportunityId=opp-1&sessionId=session-now&status=in_progress"));
    expect(screen.queryByRole("combobox", { name: "Operational view" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sessions" })).not.toBeNull();
    expect(await screen.findByRole("link", { name: "Acme live demo" })).not.toBeNull();
    expect(window.sessionStorage.getItem(salesSessionProvisionDraftKey("sales-admin@certalis.demo"))).toBeNull();
  });

  it("returns from Provision Manage directly to the canonical Active queue", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input) => String(input).startsWith("/api/sales/session-opportunities?")
      ? json({ accounts: [], opportunities: [], total: 0 })
      : String(input).includes("queue=1")
        ? json({ view: "active", offset: 0, limit: 25, total: 0, rows: [] })
        : json({ activeItems: [] }));
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);

    await user.click(screen.getByRole("button", { name: "Manage" }));

    expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions");
    expect(screen.queryByRole("combobox", { name: "Operational view" })).toBeNull();
    expect(await screen.findByRole("heading", { name: "Sessions" })).not.toBeNull();
  });

  it("restores a versioned Provision draft after remount without retaining protected evidence", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", accountName: "Acme", name: "Evaluation", label: "Acme - Evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [{ id: "item-1", name: "Accelerate Demo", description: "", project: { id: "project-1", name: "Project" }, blueprints: [], policy: { id: "policy-1", name: "Policy" }, regions: [], defaultDurationMinutes: 60, status: "active" }] });
      if (path.startsWith("/api/sales/enablement-sessions/project-members?")) return json({ members: [{ email: "rep@certalis.demo", displayName: "Sales Rep" }] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: { timeZone: "UTC", experienceType: "demo" } });
      if (path === "/api/sales/session-configuration") return json({ template: "Server {opportunity} ({revision})" });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    const first = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await chooseSearchableOption(user, "Opportunity", "Acme - Evaluation");
    await user.selectOptions(screen.getByRole("combobox", { name: "Catalogue Item" }), "item-1");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sales Pro" }), "rep@certalis.demo");
    await user.click(screen.getByRole("radio", { name: "Schedule start" }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-07-20T09:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-07-20T11:30" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Session name template" }), { target: { value: "Draft {opportunity} ({revision})" } });
    const storageKey = salesSessionProvisionDraftKey("sales-admin@certalis.demo");
    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toContain("Draft {opportunity}"));
    expect(window.sessionStorage.getItem(storageKey)).not.toContain("diagnostic");
    expect(window.sessionStorage.getItem(storageKey)).not.toContain("loginUrl");

    first.unmount();
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "provision" }} />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Catalogue Item" }) as HTMLSelectElement).value).toBe("item-1"));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Sales Pro" }) as HTMLSelectElement).value).toBe("rep@certalis.demo"));
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("2026-07-20T09:00");
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("2026-07-20T11:30");
    expect((screen.getByRole("textbox", { name: "Session name template" }) as HTMLInputElement).value).toBe("Draft {opportunity} ({revision})");
  });

  it("never hydrates Manage Account or Opportunity filters from a Provision draft", async () => {
    window.sessionStorage.setItem(salesSessionProvisionDraftKey("sales-admin@certalis.demo"), JSON.stringify({ version: 1, accountId: "draft-account", opportunityId: "draft-opportunity", itemId: "item-1", salesProEmail: "rep@certalis.demo", startMode: "scheduled", start: "2026-07-20T09:00", end: "2026-07-20T10:00", endHasManualOverride: true, timeZone: "UTC", type: "demo", sessionNameTemplate: "Draft {opportunity} ({revision})" }));
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "draft-account", name: "Draft Account" }], opportunities: [{ id: "draft-opportunity", accountId: "draft-account", accountName: "Draft Account", name: "Draft Opportunity", label: "Draft Account - Draft Opportunity" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones") return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/session-configuration") return json({});
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/sales/enablement-sessions?experienceStatus=notStarted"))).toBe(true));
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const manageRequests = fetchMock.mock.calls.map(([input]) => String(input)).filter((path) => path.startsWith("/api/sales/enablement-sessions?"));
    expect(manageRequests.every((path) => !path.includes("accountId=") && !path.includes("opportunityId="))).toBe(true);
    expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLInputElement).value).toBe("");
  });

  it("restores route-backed Manage filters and requests separate status dimensions", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [{ id: "account-1", name: "Acme" }], opportunities: [{ id: "opp-1", accountId: "account-1", accountName: "Acme", name: "Evaluation", label: "Acme - Evaluation" }], total: 1 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [{ id: "session-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", sessionName: "Acme evaluation", start: "2026-08-15T08:00", end: "2026-08-15T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-15T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "notStarted", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: true }] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage", accountId: "account-1", opportunityId: "opp-1" }} />);

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Account" }) as HTMLInputElement).value).toBe("Acme"));
    expect((screen.getByRole("combobox", { name: "Opportunity" }) as HTMLInputElement).value).toBe("Acme - Evaluation");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("experienceStatus=notStarted") && String(input).includes("accountId=account-1") && String(input).includes("opportunityId=opp-1"))).toBe(true);
    expect(await screen.findByText(/CloudShare Sales Experience: notStarted \(schedule prediction; no fresh provider read\)/)).not.toBeNull();

    await user.selectOptions(screen.getByRole("combobox", { name: "Operational view" }), "needs_attention");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("operationStatus=needs_attention"))).toBe(true));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("operationStatus=needs_attention") && String(input).includes("experienceStatus="))).toBe(false);
  });

  it("paginates bounded participant search without exposing provider IDs or diagnostics", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/enablement-sessions?participantSearch=")) return path.includes("offset=20")
        ? json({ participants: [{ id: "portal-21", sessionId: "session-21", sessionName: "Brio trial", opportunityId: "opp-21", firstName: "Ada", lastName: "Twenty-one", email: "ada21@example.test", environment: { dimension: "cloudshare_environment", value: "Suspended", source: "cloudshare_v3_environment", observedAt: "2026-07-19T09:00:00.000Z" } }], total: 21, offset: 20, limit: 20 })
        : json({ participants: [{ id: "portal-1", sessionId: "session-1", sessionName: "Acme evaluation", opportunityId: "opp-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", environment: { dimension: "cloudshare_environment", value: "Deleted", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-19T09:00:00.000Z" } }], total: 21, offset: 0, limit: 20 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ sessions: [] });
      return json({});
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);

    await user.type(screen.getByRole("textbox", { name: "Search participant name or email" }), "ada");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/Session: Acme evaluation · Environment state: Deleted \(cloudshare_environment, cloudshare_v4_sales_participant_roster\)/)).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain("1–1 of 21");
    await user.click(screen.getByRole("button", { name: "Next participant results" }));
    expect(await screen.findByText(/Session: Brio trial · Environment state: Suspended/)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("participantSearch=ada&offset=20&limit=20"), expect.objectContaining({ cache: "no-store" }));
    expect(document.body.textContent).not.toContain("cloudshare-environment-raw");
    expect(document.body.textContent).not.toContain("provider response");
  });

  it.each([
    ["in-progress", "in_progress", { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, { dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction", freshness: "predicted" }],
    ["ended", "ended", { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, { dimension: "cloudshare_sales_experience", value: "ended", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-07-19T09:00:00.000Z" }],
    ["needs-attention", "needs_attention", { dimension: "certalis_operation", value: "needs_attention", source: "certalis_persistence", retry: "unsafe_requires_support", reason: "Provider status needs support" }, { dimension: "cloudshare_sales_experience", value: "inProgress", source: "schedule_prediction", freshness: "predicted" }],
  ])("opens and visibly focuses a %s Session selected from participant search", async (_label, routeStatus, operation, experience) => {
    const user = userEvent.setup();
    const session = { id: `session-${routeStatus}`, opportunityId: "opp-1", itemId: "item-1", type: "demo", sessionName: `Focused ${routeStatus}`, start: "2026-07-19T08:00", end: "2026-07-19T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-19T07:00:00.000Z", operation, experience, verificationEligible: routeStatus !== "needs_attention" };
    const expectedDimension = routeStatus === "needs_attention" ? "operationStatus=needs_attention" : `experienceStatus=${routeStatus === "in_progress" ? "inProgress" : "ended"}`;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path.startsWith("/api/sales/enablement-sessions?participantSearch=")) return json({ participants: [{ id: "portal-1", sessionId: session.id, sessionName: session.sessionName, opportunityId: "opp-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", operation, experience, environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v3_environment", observedAt: "2026-07-19T09:00:00.000Z" } }], total: 1, offset: 0, limit: 20 });
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path === `/api/sales/enablement-sessions/${session.id}/participants`) return json({ session: { accessWindow: { dimension: "certalis_session_access_window", value: "open", source: "schedule_calculation", nativeInvitationsAvailable: true } }, participants: [] });
      if (path.startsWith("/api/sales/enablement-sessions?")) {
        return json({ sessions: path.includes(expectedDimension) ? [session] : [] });
      }
      return json({});
    });
    const rendered = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);

    await user.type(screen.getByRole("textbox", { name: "Search participant name or email" }), "ada");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Ada Lovelace (ada@example.test)" }));

    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith(`/sales?tab=sessions&sessionId=${session.id}&status=${routeStatus}&participants=open`));
    rendered.unmount();
    fetchMock.mockClear();
    let remounted = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage", sessionId: session.id, sessionStatus: routeStatus as "in_progress" | "ended" | "needs_attention", participantsOpen: true }} />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes(expectedDimension))).toBe(true));
    await waitFor(() => expect(document.getElementById(`sales-session-${session.id}`)).not.toBeNull());
    expect(document.getElementById(`sales-session-${session.id}`)?.textContent).toContain(`Focused ${routeStatus}`);
    expect(document.getElementById(`sales-session-${session.id}`)?.style.background).toBe("rgb(232, 245, 243)");
    expect(await screen.findByRole("button", { name: "Hide participants" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Hide participants" }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith(`/sales?tab=sessions&sessionId=${session.id}&status=${routeStatus}`, { scroll: false }));
    expect(screen.getByRole("button", { name: "Manage participants" })).not.toBeNull();
    remounted.unmount();
    remounted = render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage", sessionId: session.id, sessionStatus: routeStatus as "in_progress" | "ended" | "needs_attention" }} />);
    expect(await screen.findByRole("button", { name: "Manage participants" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Manage participants" }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith(`/sales?tab=sessions&sessionId=${session.id}&status=${routeStatus}&participants=open`, { scroll: false }));
    remounted.unmount();
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage", sessionId: session.id, sessionStatus: routeStatus as "in_progress" | "ended" | "needs_attention", participantsOpen: true }} />);
    expect(await screen.findByRole("button", { name: "Hide participants" })).not.toBeNull();
    expect(mockRouter.push.mock.calls.at(-1)?.[0]).not.toContain("provider");
  });

  it("registers named Opportunity Contacts without sending mail, then sends a selected native invite without exposing provider identifiers", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    let participantReads = 0;
    let launchLinkCreates = 0;
    let invitationRequests = 0;
    const registeredParticipant = { id: "portal-participant-1", opportunityContactId: "contact-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", invitationStatus: "notSent", lastInvitedAt: "2026-07-18T09:15:00.000Z", invitedBy: null, participationStatus: "pending", firstJoined: null, envStatus: "running", environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v3_environment", observedAt: "2026-07-18T09:14:00.000Z" } };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      if (path === "/api/sales/items") return json({ activeItems: [] });
      if (path === "/api/sales/timezones" && !init?.method) return json({ timezones: [{ id: "UTC", name: "UTC" }], preference: {} });
      if (path === "/api/sales/timezones" && init?.method === "PUT") return new Response(null, { status: 204 });
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [], total: 0 });
      if (path.startsWith("/api/sales/enablement-sessions?") && !init?.method) return json({ sessions: [{ id: "session-1", opportunityId: "opp-1", itemId: "item-1", type: "demo", start: "2026-07-17T09:00", end: "2026-07-17T10:00", timeZone: "UTC", salesProDisplayName: "Sales Admin", createdAt: "2026-07-17T00:00:00Z", operation: { dimension: "certalis_operation", value: "correlated", source: "certalis_persistence", retry: "not_applicable" }, experience: { dimension: "cloudshare_sales_experience", value: "notStarted", source: "schedule_prediction", freshness: "predicted" }, verificationEligible: true }] });
      if (path === "/api/sales/accounts") return json({ contacts: [{ id: "contact-1", opportunityId: "opp-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", archivedAt: null, createdAt: "2026-07-17T00:00:00Z" }] });
      if (path === "/api/sales/enablement-sessions/session-1/participants" && !init?.method) { participantReads += 1; return participantReads === 2 ? json({ error: "Monitoring temporarily unavailable" }, 502) : json({ session: { accessWindow: { dimension: "certalis_session_access_window", value: "open", source: "schedule_calculation", nativeInvitationsAvailable: true } }, participants: participantReads >= 3 ? [{ ...registeredParticipant, invitationStatus: "sent", lastInvitedAt: "2026-07-18T09:45:00.000Z" }] : [], correlationId: "corr-read-1" }); }
      if (path === "/api/sales/enablement-sessions/session-1/participants" && init?.method === "POST") return json({ participants: [registeredParticipant], correlationId: "corr-register-1" }, 201);
      if (path === "/api/sales/enablement-sessions/session-1/participants/invite" && init?.method === "POST") { invitationRequests += 1; return invitationRequests === 3 ? json({ error: "Native invitation failed.", correlationId: "corr-invite-fail" }, 502) : json({ correlationId: "corr-invite-1" }); }
      if (path === "/api/sales/enablement-sessions/session-1/participants/portal-participant-1/launch-link" && init?.method === "POST") { launchLinkCreates += 1; return launchLinkCreates === 3 ? json({ error: "Launch link generation failed.", correlationId: "corr-launch-fail" }, 502) : json({ launchUrl: "/sales/launch/opaque-certalis-token", correlationId: "corr-launch-1" }, 201); }
      if (path === "/api/sales/enablement-sessions/session-1/participants/portal-participant-1/launch-link" && init?.method === "DELETE") return json({ correlationId: "corr-revoke-1" });
      return json({ error: `Unexpected request ${path}` }, 500);
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "sessions", sessionView: "manage" }} />);
    await user.click(await screen.findByRole("button", { name: "Manage participants" }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith("/sales?tab=sessions&sessionId=session-1&participants=open", { scroll: false }));
    await user.click(await screen.findByLabelText(/Ada Lovelace$/));
    await user.click(screen.getByRole("button", { name: "Register or repair selected participants" }));
    expect((await screen.findByText("Sales Participants registered. No native invitations were sent.")).closest("[role]")?.getAttribute("role")).toBe("status");
    expect(screen.queryByLabelText(/^Ada Lovelace$/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions/session-1/participants", expect.objectContaining({ method: "POST", body: JSON.stringify({ contactIds: ["contact-1"] }) }));
    expect(screen.queryByText("cloudshare-participant-1")).toBeNull();
    expect(screen.getByText("ada@example.test")).not.toBeNull();
    expect(screen.getByText("Ready")).not.toBeNull();
    expect(screen.getByText(/CloudShare Environment · cloudshare_v3_environment/)).not.toBeNull();
    expect(document.querySelector('time[datetime="2026-07-18T09:15:00.000Z"]')?.getAttribute("title")).toContain("2026-07-18 09:15:00 UTC");
    await user.click(screen.getByLabelText("Select Ada Lovelace for native invite"));
    await user.click(screen.getByRole("button", { name: "Send or resend native invites" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions/session-1/participants/invite", expect.objectContaining({ method: "POST", body: JSON.stringify({ participantIds: ["portal-participant-1"] }) }));
    expect((await screen.findByText("Native CloudShare invitations were requested. Participant monitoring could not refresh; investigate the invite evidence before retrying.")).closest("[role]")?.getAttribute("role")).toBe("alert");
    expect(screen.getByRole("button", { name: "Open support diagnostics for latest participant operation (corr-invite-1)" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy launch link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/sales/launch/opaque-certalis-token")));
    expect((await screen.findByText("Personalised Certalis launch link copied. Any prior link for this participant is now revoked.")).closest("[role]")?.getAttribute("role")).toBe("status");
    await user.click(screen.getByRole("button", { name: "Copy launch link" }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("cloudshare.example")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revoke link" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sales/enablement-sessions/session-1/participants/portal-participant-1/launch-link", expect.objectContaining({ method: "DELETE" }));
    expect((await screen.findByText("Personalised Certalis launch link revoked.")).closest("[role]")?.getAttribute("role")).toBe("status");
    await user.click(screen.getByRole("button", { name: "Copy launch link" }));
    expect((await screen.findByText("Launch link generation failed.")).closest("[role]")?.getAttribute("role")).toBe("alert");
    expect(screen.getByRole("button", { name: "Open support diagnostics (corr-launch-fail)" })).not.toBeNull();
    await user.click(screen.getByLabelText("Select Ada Lovelace for native invite"));
    await user.click(screen.getByRole("button", { name: "Send or resend native invites" }));
    expect((await screen.findByText("Native CloudShare invitations requested for selected Sales Participants. Refresh engagement to confirm their state.")).closest("[role]")?.getAttribute("role")).toBe("status");
    expect(document.querySelector('time[datetime="2026-07-18T09:45:00.000Z"]')?.getAttribute("title")).toContain("2026-07-18 09:45:00 UTC");
    await user.click(screen.getByLabelText("Select Ada Lovelace for native invite"));
    await user.click(screen.getByRole("button", { name: "Send or resend native invites" }));
    expect((await screen.findByText("Native invitation failed.")).closest("[role]")?.getAttribute("role")).toBe("alert");
    expect(screen.getByRole("button", { name: "Open support diagnostics (corr-invite-fail)" })).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
