/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesWorkspace } from "./sales-workspace";

const { mockRouter } = vi.hoisted(() => ({ mockRouter: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SalesWorkspace interaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("submits Account creation through the authenticated Sales API control without console errors", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return json({ account: { id: "account-1" } }, 201);
      return json({ accounts: [], opportunities: [], contacts: [] });
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<SalesWorkspace email="sales-admin@certalis.demo" />);
    await screen.findByText("No Accounts yet.");
    await user.type(screen.getByRole("textbox", { name: "Account name" }), "Acme Labs");
    await user.selectOptions(screen.getByRole("combobox", { name: "Account type" }), "current_customer");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sales/accounts", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Acme Labs", kind: "current_customer" }) })));
    expect(consoleError).not.toHaveBeenCalled();
  });
});
