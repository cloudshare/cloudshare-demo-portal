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
  afterEach(() => { vi.restoreAllMocks(); mockSearchParams.delete("accountId"); mockSearchParams.delete("opportunityId"); mockRouter.replace.mockClear(); });

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
    await screen.findByRole("button", { name: "Select Acme Labs" });
    await user.click(screen.getByRole("button", { name: "Select Acme Labs" }));

    expect(mockRouter.replace).toHaveBeenCalledWith("/sales?accountId=account-1");
    expect(screen.getByText("Acme proof")).not.toBeNull();
    expect(screen.queryByText("Helios renewal")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps the selected Account as visible history when it is archived", async () => {
    const user = userEvent.setup();
    let archived = false;
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") { archived = true; return json({ account: { id: "account-1" } }); }
      return json({ accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: archived ? "2026-07-12T17:01:00.000Z" : null, createdAt: "2026-07-12T17:00:00.000Z" }], opportunities: [], contacts: [] });
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    await screen.findByRole("button", { name: "Select Acme Labs" });
    await user.click(screen.getByRole("button", { name: "Select Acme Labs" }));
    mockRouter.replace.mockClear();

    await user.click(screen.getByRole("button", { name: "Archive Account" }));

    await waitFor(() => expect((screen.getByRole("combobox", { name: "Accounts lifecycle" }) as HTMLSelectElement).value).toBe("archived"));
    expect(screen.getByRole("button", { name: "Select Acme Labs" })).not.toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();
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
    await screen.findByRole("button", { name: "Select Active Acme" });
    expect(screen.queryByRole("button", { name: "Select Historical Acme" })).toBeNull();

    await user.selectOptions(screen.getByRole("combobox", { name: "Accounts lifecycle" }), "archived");
    expect(screen.getByRole("button", { name: "Select Historical Acme" })).not.toBeNull();
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
    expect(screen.getByRole("button", { name: "Select Historical Acme" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Select Historical proof" })).not.toBeNull();
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
    expect(document.activeElement).toBe(screen.getByLabelText("Account name"));
    await user.keyboard("{Tab}{Tab}{Tab}{Tab}");
    expect(document.activeElement).toBe(screen.getByLabelText("Account name"));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "New Account" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New Account" }));
  });
});
