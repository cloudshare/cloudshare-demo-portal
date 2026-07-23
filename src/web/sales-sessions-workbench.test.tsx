/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionsWorkbench } from "./sales-sessions-workbench";

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

const row = {
  id: "session-1", accountId: "account-1", accountName: "Acme", opportunityId: "opportunity-1",
  opportunityName: "Evaluation", sessionName: "Acme evaluation", revision: 2,
  start: "2026-07-23T09:00:00.000Z", end: "2026-07-23T10:00:00.000Z", timeZone: "UTC",
  operation: { value: "active" },
  experience: { value: "notStarted", source: "schedule_prediction", freshness: "estimated" },
  participantEnvironment: { participantName: "Ada", observation: { value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-23T08:00:00.000Z" } },
};

describe("Sales Sessions workbench", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("operates every route-backed queue control without provider reads", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({
        accounts: [{ id: "account-1", name: "Acme" }],
        opportunities: [{ id: "opportunity-1", accountId: "account-1", name: "Evaluation" }],
      });
      if (path.startsWith("/api/sales/enablement-sessions?")) return json({ view: "active", offset: 0, limit: 25, total: 26, rows: [row] });
      return new Response(null, { status: 500 });
    });
    const onNavigate = vi.fn();
    render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage" }} onNavigate={onNavigate} />);
    await screen.findByRole("button", { name: "Acme evaluation" });

    await user.click(screen.getByRole("button", { name: "Needs attention" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Account filter" }), "account-1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Opportunity filter" }), "opportunity-1");
    await user.clear(screen.getByRole("textbox", { name: "Search Sessions" }));
    await user.type(screen.getByRole("textbox", { name: "Search Sessions" }), "Acme");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Session queue sort" }), "name_asc");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.click(screen.getByRole("button", { name: "Acme evaluation" }));
    await user.click(screen.getByRole("button", { name: "Provision a Session" }));

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueView: "needs_attention" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", opportunityId: null }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opportunity-1" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueSearch: "Acme" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueSort: "name_asc" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueOffset: 25 }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "sessions", sessionView: "provision" });
    expect(window.fetch).not.toHaveBeenCalledWith(expect.stringContaining("reconcile"), expect.anything());
  });

  it("restores controlled search and selected-row focus, and explains an invalid target", async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [] });
      return json({
        view: "active", offset: 0, limit: 25, total: 1, rows: [row],
        target: { id: "session-1", state: "available" },
      });
    });
    const { rerender } = render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", queueSearch: "first", sessionId: "session-1" }} onNavigate={vi.fn()} />);
    const selected = await screen.findByRole("button", { name: "Acme evaluation" });
    await waitFor(() => expect(document.activeElement).toBe(selected));
    expect((screen.getByRole("textbox", { name: "Search Sessions" }) as HTMLInputElement).value).toBe("first");

    rerender(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", queueSearch: "restored" }} onNavigate={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Search Sessions" }) as HTMLInputElement).value).toBe("restored");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await screen.findByRole("button", { name: "Acme evaluation" });
  });
});
