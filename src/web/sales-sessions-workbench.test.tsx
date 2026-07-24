/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionsWorkbench } from "./sales-sessions-workbench";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const row = {
  id: "session-1", accountId: "account-1", accountName: "Acme", opportunityId: "opportunity-1",
  opportunityName: "Evaluation", sessionName: "Acme evaluation", revision: 2,
  start: "2026-07-23T09:00:00.000Z", end: "2026-07-23T10:00:00.000Z", timeZone: "UTC",
  operation: { value: "active", source: "certalis_persistence" },
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
    await screen.findByRole("link", { name: "Acme evaluation" });

    expect(screen.getByText("Session queue")).not.toBeNull();
    expect(screen.getByText("Active Sessions")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Session queue controls" })).not.toBeNull();
    expect(screen.getByText("Recorded by Certalis persistence.")).not.toBeNull();
    expect(screen.getByText("Observed from CloudShare participant roster · 2026-07-23T08:00:00.000Z")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Needs attention" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Account filter" }), "account-1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Opportunity filter" }), "opportunity-1");
    await user.clear(screen.getByRole("textbox", { name: "Search Sessions" }));
    await user.type(screen.getByRole("textbox", { name: "Search Sessions" }), "Acme");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Session queue sort" }), "name_asc");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("link", { name: "Acme evaluation" }).getAttribute("href")).toContain("/sales/sessions/session-1?");
    await user.click(screen.getByRole("button", { name: "Provision a Session" }));

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueView: "needs_attention" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", opportunityId: null }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "opportunity-1" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueSearch: "Acme" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueSort: "name_asc" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ queueOffset: 25 }));
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
    const selected = await screen.findByRole("link", { name: "Acme evaluation" });
    await waitFor(() => expect(document.activeElement).toBe(selected));
    expect((screen.getByRole("textbox", { name: "Search Sessions" }) as HTMLInputElement).value).toBe("first");

    rerender(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", queueSearch: "restored" }} onNavigate={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Search Sessions" }) as HTMLInputElement).value).toBe("restored");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await screen.findByRole("link", { name: "Acme evaluation" });
  });

  it("restores a selected Opportunity outside the first bounded options page", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({
        accounts: [],
        opportunities: [{ id: "opportunity-51", accountId: "account-51", name: "Restored opportunity" }],
      });
      return json({ view: "active", offset: 0, limit: 25, total: 0, rows: [] });
    });
    render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", opportunityId: "opportunity-51" }} onNavigate={vi.fn()} />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("selectedOpportunityId=opportunity-51"))).toBe(true));
    expect((screen.getByRole("combobox", { name: "Opportunity filter" }) as HTMLSelectElement).value).toBe("opportunity-51");
  });

  it("shows a safe durable alert when bounded relationship options cannot load", async () => {
    vi.spyOn(window, "fetch").mockImplementation(async (input) => String(input).startsWith("/api/sales/session-opportunities?")
      ? json({ error: "unavailable" }, 503)
      : json({ view: "active", offset: 0, limit: 25, total: 0, rows: [] }));
    render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage" }} onNavigate={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Account and Opportunity filters could not be loaded");
  });

  it("retains the last safe queue and offers Retry and Support after a queue read fails", async () => {
    const user = userEvent.setup();
    let queueReads = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [] });
      queueReads += 1;
      if (queueReads === 2) return json({ error: "Queue temporarily unavailable" }, 503);
      return json({ view: "active", offset: 0, limit: 25, total: 1, rows: [row] });
    });
    const onNavigate = vi.fn();
    const rendered = render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage" }} onNavigate={onNavigate} />);
    expect(await screen.findByRole("link", { name: "Acme evaluation" })).not.toBeNull();

    rendered.rerender(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", queueSearch: "changed" }} onNavigate={onNavigate} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Queue temporarily unavailable");
    expect(screen.getByRole("link", { name: "Acme evaluation" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Open Sales support" }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "support" });
    await user.click(screen.getByRole("button", { name: "Retry queue" }));
    await waitFor(() => expect(queueReads).toBe(3));
  });

  it("keeps a failed cross-view transition labelled and paginated as the last successful result", async () => {
    let queueReads = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (String(input).startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [] });
      queueReads += 1;
      return queueReads === 1
        ? json({ view: "active", offset: 25, limit: 25, total: 51, rows: [row] })
        : json({ error: "Needs-attention page unavailable" }, 503);
    });
    const rendered = render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", queueView: "active", queueOffset: 25 }} onNavigate={vi.fn()} />);
    expect(await screen.findByText("Active Sessions")).not.toBeNull();
    expect(screen.getByText("26–26 of 51")).not.toBeNull();

    rendered.rerender(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage", queueView: "needs_attention", queueOffset: 0 }} onNavigate={vi.fn()} />);

    expect(await screen.findByText("Needs-attention page unavailable", { exact: false })).not.toBeNull();
    expect(screen.getByText("Active Sessions")).not.toBeNull();
    expect(screen.queryByText("Sessions needing attention")).toBeNull();
    expect(screen.getByText("26–26 of 51")).not.toBeNull();
  });

  it("keeps the workbench and correctly labelled Active result visible while History is loading", async () => {
    const user = userEvent.setup();
    let resolveHistory!: (response: Response) => void;
    const historyResponse = new Promise<Response>((resolve) => { resolveHistory = resolve; });
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith("/api/sales/session-opportunities?")) return json({ accounts: [], opportunities: [] });
      if (path.includes("view=history")) return historyResponse;
      return json({ view: "active", offset: 0, limit: 25, total: 1, rows: [row] });
    });
    const route = { tab: "sessions", sessionView: "manage", queueView: "active" } as const;
    const rendered = render(<SalesSessionsWorkbench route={route} onNavigate={(intent) => {
      rendered.rerender(<SalesSessionsWorkbench route={{ ...route, queueView: intent.queueView ?? "active" }} onNavigate={() => undefined} />);
    }} />);
    expect(await screen.findByRole("link", { name: "Acme evaluation" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "History" }));

    expect(screen.getByRole("heading", { name: "Sessions" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Active Sessions")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Acme evaluation" })).not.toBeNull();
    const queueFrame = screen.getByRole("region", { name: "Active Sessions" });
    const visibleHeading = screen.getByText("Active Sessions");
    expect(queueFrame.getAttribute("aria-labelledby")).toBe(visibleHeading.id);
    expect(queueFrame.getAttribute("aria-busy")).toBe("true");
    const loadingStatus = screen.getByRole("status", { name: "History queue loading status" });
    expect(loadingStatus.textContent).toContain("Loading the local Sessions queue");
    expect(queueFrame.contains(loadingStatus)).toBe(false);

    resolveHistory(json({ view: "history", offset: 0, limit: 25, total: 0, rows: [] }));
    expect(await screen.findByText("Session history")).not.toBeNull();
  });

  it("labels an unassigned participant without claiming a CloudShare observation", async () => {
    vi.spyOn(window, "fetch").mockImplementation(async (input) => String(input).startsWith("/api/sales/session-opportunities?")
      ? json({ accounts: [], opportunities: [] })
      : json({ view: "active", offset: 0, limit: 25, total: 1, rows: [{ ...row, participantEnvironment: { participantName: "Ada", observation: { value: null, source: "not_assigned" } } }] }));

    render(<SalesSessionsWorkbench route={{ tab: "sessions", sessionView: "manage" }} onNavigate={vi.fn()} />);

    expect(await screen.findByText("Ada: Not assigned")).not.toBeNull();
    expect(screen.getByText("No CloudShare Environment is assigned.")).not.toBeNull();
    expect(screen.queryByText(/Observed from CloudShare participant roster/)).toBeNull();
  });
});
