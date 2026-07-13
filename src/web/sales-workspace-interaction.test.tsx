/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
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
  afterEach(() => { vi.restoreAllMocks(); mockSearchParams.delete("accountId"); mockSearchParams.delete("opportunityId"); mockRouter.replace.mockClear(); window.history.replaceState({}, "", "/sales"); });

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

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    const acmeRow = await screen.findByRole("row", { name: /Acme Labs/ });
    await user.click(acmeRow);

    expect(mockRouter.replace).toHaveBeenCalledWith("/sales?accountId=account-1", { scroll: false });
    expect(window.location.search).toBe("?accountId=account-1");
    expect(acmeRow.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Acme proof")).not.toBeNull();
    expect(screen.queryByText("Helios renewal")).toBeNull();
    expect(screen.getByRole("region", { name: "Opportunities" }).textContent).toContain("Selected Account: Acme Labs");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("restores initial URL selection from the server query state even before client search params settle", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      opportunities: [{ id: "opportunity-1", accountId: "account-1", name: "Acme proof", status: "open", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      contacts: [{ id: "contact-1", opportunityId: "opportunity-1", firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" initialSelection={{ accountId: "account-1", opportunityId: "opportunity-1" }} />);

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
    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
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

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
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

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);

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
    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    await user.click(screen.getByRole("button", { name: "New Account" }));
    expect(screen.getByRole("dialog", { name: "New Account" })).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Account name")));
    await user.keyboard("{Tab}{Tab}{Tab}{Tab}");
    expect(document.activeElement).toBe(screen.getByLabelText("Account name"));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "New Account" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New Account" }));
  });

  it("explains disabled child creation and locks a new Opportunity to the selected Account", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockResolvedValue(json({
      accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }],
      opportunities: [], contacts: [],
    }));

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    const newOpportunity = await screen.findByRole("button", { name: "New Opportunity" });
    expect((newOpportunity as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Select an Account to add an Opportunity.")).not.toBeNull();

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

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    await screen.findByRole("row", { name: /Acme Labs/ });
    expect((screen.getByRole("button", { name: "New Contact" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Select an Opportunity to add a Contact.")).not.toBeNull();
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

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
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
});
