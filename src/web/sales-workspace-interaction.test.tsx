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
  afterEach(() => vi.restoreAllMocks());

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

  it("clears the URL selection when archiving the selected Account", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return json({ account: { id: "account-1" } });
      return json({ accounts: [{ id: "account-1", name: "Acme Labs", kind: "prospect", archivedAt: null, createdAt: "2026-07-12T17:00:00.000Z" }], opportunities: [], contacts: [] });
    });
    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    await screen.findByRole("button", { name: "Select Acme Labs" });
    await user.click(screen.getByRole("button", { name: "Select Acme Labs" }));
    mockRouter.replace.mockClear();

    await user.click(screen.getByRole("button", { name: "Archive Account" }));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/sales"));
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
});
