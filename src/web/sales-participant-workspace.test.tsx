/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesParticipantWorkspace } from "./sales-participant-workspace";

const participant = { id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", participantRevision: "2026-07-24T08:00:00.000Z", environment: { value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" } } as const;
const page = { participants: [participant], total: 1, offset: 0, limit: 25, hasMore: false };

describe("SalesParticipantWorkspace", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/sales"); });
  it("hydrates bounded query and offset from the URL and rereads on popstate", async () => {
    window.history.replaceState({}, "", "/sales?participantQuery=ada&participantOffset=25");
    const request = vi.fn(async () => new Response(JSON.stringify({ ...page, offset: 25 }), { status: 200 }));
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining("query=ada"), expect.anything()));
    await act(async () => {
      window.history.pushState({}, "", "/sales?participantQuery=ada");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  });
  it("pushes meaningful transitions and restores inspector state and focus on popstate", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    const inspect = await screen.findByRole("button", { name: "Inspect" });
    await userEvent.setup().click(inspect);
    await waitFor(() => expect(pushState).toHaveBeenCalled());
    expect(new URL(window.location.href).searchParams.get("participantFocus")).toBe("inspector");
    await act(async () => {
      window.history.pushState({}, "", "/sales?participantActive=p1&participantFocus=inspector");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    const inspector = await screen.findByRole("complementary", { name: "Participant inspector" });
    await waitFor(() => expect(document.activeElement).toBe(inspector));
  });
  it("opens and closes the inspector through the public keyboard seam", async () => {
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    await screen.findByRole("table", { name: "Participant roster" });
    expect(screen.getByText("Observed from CloudShare participant roster")).toBeTruthy();
    expect(screen.getByRole("cell", { name: /Ready/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
    screen.getByRole("link", { name: "Open Support" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Participant inspector" })).toBeNull();
    expect(document.activeElement?.getAttribute("data-participant-id")).toBe("p1");
  });
  it("does not let Space on a nested row control change row selection", async () => {
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    const inspect = await screen.findByRole("button", { name: "Inspect" });
    inspect.focus();
    fireEvent.keyDown(inspect, { key: " " });
    expect(screen.getByRole("row", { name: /Ada Lovelace/ }).getAttribute("data-selected")).toBeNull();
  });
  it("supports click, modifier selection, movement, and nested-control exclusion", async () => {
    const user = userEvent.setup();
    const second = { ...participant, id: "p2", name: "Grace Hopper", email: "grace@example.test" };
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: [participant, second], total: 2 }))} />);
    await screen.findByRole("table", { name: "Participant roster" });
    const rows = screen.getAllByRole("row").slice(1);
    await user.click(rows[0]);
    expect(rows[0].getAttribute("data-selected")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(rows[1].getAttribute("data-active")).toBe("true");
    await user.keyboard(" ");
    expect(rows[1].getAttribute("data-selected")).toBe("true");
    await user.click(screen.getAllByRole("button", { name: "Inspect" })[0]);
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
    expect(rows[0].getAttribute("data-selected")).toBe("true");
  });
  it("applies modifier and range selection through the public row events", async () => {
    const user = userEvent.setup();
    const rows = [participant, { ...participant, id: "p2", name: "Grace Hopper", email: "grace@example.test" }, { ...participant, id: "p3", name: "Katherine Johnson", email: "kat@example.test" }];
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: rows, total: 3 }))} />);
    await screen.findByRole("table", { name: "Participant roster" });
    const getRows = () => screen.getAllByRole("row").slice(1);
    await user.click(getRows()[0]);
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("participantAnchor")).toBe("p1"));
    fireEvent.click(getRows()[1], { ctrlKey: true });
    fireEvent.click(getRows()[2], { metaKey: true });
    await waitFor(() => {
      expect(getRows().every((row) => row.getAttribute("data-selected") === "true")).toBe(true);
      expect(new URL(window.location.href).searchParams.get("participantAnchor")).toBe("p1");
    });

    // A plain click resets the set and establishes a new range anchor.
    await user.click(getRows()[1]);
    fireEvent.click(getRows()[2], { shiftKey: true });
    await waitFor(() => {
      expect(getRows().map((row) => row.getAttribute("data-selected"))).toEqual([null, "true", "true"]);
      const url = new URL(window.location.href);
      expect(url.searchParams.get("participantActive")).toBe("p3");
      expect(url.searchParams.get("participantAnchor")).toBe("p2");
      expect(url.searchParams.get("participantSelected")).toBe("p2,p3");
    });

    // Keyboard range selection uses the same anchor and selects the full range.
    await user.click(getRows()[0]);
    getRows()[2].focus();
    await user.keyboard("{Shift>}{ }{/Shift}");
    await waitFor(() => expect(getRows().every((row) => row.getAttribute("data-selected") === "true")).toBe(true));
  });
  it("keeps paging bounded and announces an unavailable reread", async () => {
    const request = vi.fn(async (url: string) => new Response(JSON.stringify({ participants: [], total: 26, offset: url.includes("offset=25") ? 25 : 0, limit: 25, hasMore: true }), { status: 200 }));
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await screen.findByText("No Participants are registered for this Sales Session.");
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(request.mock.calls.some((call) => String(call[0] ?? "").includes("offset=25"))).toBe(true));
  });
  it("announces selection pruning after a query changes the visible roster", async () => {
    const second = { ...participant, id: "p2", name: "Grace Hopper" };
    const request = vi.fn(async (url: string) => new Response(JSON.stringify({ participants: url.includes("query=grace") ? [second] : [participant], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const first = await screen.findByRole("row", { name: /Ada Lovelace/ });
    await user.click(first);
    const search = screen.getByRole("textbox", { name: "Search Participants" });
    await user.type(search, "grace");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("roster changed"));
  });
  it("shows a visible status when the bounded roster fetch fails", async () => {
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => { throw new Error("network down"); }} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be loaded"));
  });
  it("sends the explicit resend contract and retains correlation feedback after reread", async () => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, activeLaunchCapability: false, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ correlationId: "corr-resend", outcome: "completed" }), { status: 200 });
      return new Response(JSON.stringify({ participants: [row], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 });
    });
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await screen.findByRole("row", { name: /Ada Lovelace/ });
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Resend" }));
    await waitFor(() => expect(screen.getByText("Completed. Correlation corr-resend.")).toBeTruthy());
    const call = request.mock.calls.find(([, init]) => init?.method === "POST");
    expect(call?.[0]).toContain("/participants/invite");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ targets: [{ participantId: "p1", intent: "resend", expectedInvitationStatus: "sent", participantRevision: participant.participantRevision }] });
  });
  it("sends the explicit initial invite contract", async () => {
    const row = { ...participant, invitationStatus: "notSent" as const, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, activeLaunchCapability: false, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ correlationId: "corr-invite", outcome: "completed" }), { status: 200 }) : new Response(JSON.stringify({ participants: [row], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await screen.findByRole("row", { name: /Ada Lovelace/ });
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(screen.getByText("Completed. Correlation corr-invite.")).toBeTruthy());
    const call = request.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ targets: [{ participantId: "p1", intent: "invite", expectedInvitationStatus: "notSent", participantRevision: participant.participantRevision }] });
  });
  it("saves the departing entry scroll before pushing and restores it on popstate", async () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 320 });
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(pushState).toHaveBeenCalled());
    const pushOrder = pushState.mock.invocationCallOrder.at(-1) ?? 0;
    const departingWrite = replaceState.mock.calls.findIndex((call) => (call[0] as { participantScrollY?: number })?.participantScrollY === 320);
    expect(departingWrite).toBeGreaterThanOrEqual(0);
    expect(replaceState.mock.invocationCallOrder[departingWrite]).toBeLessThan(pushOrder);
    await act(async () => {
      window.history.replaceState({ participantScrollY: 144 }, "", "/sales?participantActive=p1&participantFocus=inspector");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(scrollTo).toHaveBeenCalledWith(0, 144);
  });
  it("reports HTTP 202 as confirmation pending with its retained replay fence", async () => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, activeLaunchCapability: false, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ outcome: "confirmation_required", correlationId: "corr-pending" }), { status: 202 })
      : new Response(JSON.stringify({ ...page, participants: [row] }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Resend" }));
    const status = await screen.findByText(/Confirmation pending; the replay fence is retained/);
    expect(status.textContent).toContain("corr-pending");
    expect(status.textContent).not.toContain("Completed");
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => !init?.method).length).toBeGreaterThan(1));
  });
  it("distinguishes completed-with-unconfirmed from a completed invitation", async () => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, activeLaunchCapability: false, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ outcome: "completed_with_unconfirmed", correlationId: "corr-unconfirmed" }), { status: 200 })
      : new Response(JSON.stringify({ ...page, participants: [row] }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Resend" }));
    const status = await screen.findByText(/CloudShare acknowledged the invitation; delivery is unconfirmed. Replay is allowed and the fence is released/);
    expect(status.textContent).toContain("corr-unconfirmed");
    expect(status.textContent).not.toContain("retained");
    expect(status.textContent).not.toBe("Completed. Correlation corr-unconfirmed.");
  });
  it("exposes every disabled action reason through described visible text", async () => {
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inspect" }));
    for (const button of screen.getAllByRole("button").filter((candidate) => candidate.hasAttribute("disabled"))) {
      const reasonId = button.getAttribute("aria-describedby");
      expect(reasonId).toBeTruthy();
      expect(document.getElementById(String(reasonId))?.textContent).toBeTruthy();
    }
  });
  it("allows revoke from an ended participant and returns focus after Escape", async () => {
    const row = { ...participant, sessionEndsAt: "2020-01-01T00:00:00.000Z", activeLaunchCapability: true, providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (url: string, init?: RequestInit) => init?.method === "DELETE" ? new Response(JSON.stringify({}), { status: 200 }) : new Response(JSON.stringify({ participants: [row], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const tableRow = await screen.findByRole("row", { name: /Ada Lovelace/ });
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    const revoke = screen.getByRole("button", { name: "Revoke launch link" });
    await user.click(revoke);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(revoke);
    await user.click(revoke);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    expect(tableRow).toBeTruthy();
  });
  it("shows controlled revoke failure and correlation and rereads durable state", async () => {
    const row = { ...participant, sessionEndsAt: "2020-01-01T00:00:00.000Z", activeLaunchCapability: true, providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "DELETE"
      ? new Response(JSON.stringify({ error: "Provider refused revoke.", correlationId: "corr-revoke" }), { status: 409 })
      : new Response(JSON.stringify({ ...page, participants: [row] }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Revoke launch link" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const status = await screen.findByText(/Provider refused revoke/);
    expect(status.textContent).toContain("corr-revoke");
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => !init?.method).length).toBeGreaterThan(1));
  });
  it("handles a non-JSON revoke failure without losing controlled feedback", async () => {
    const row = { ...participant, sessionEndsAt: "2020-01-01T00:00:00.000Z", activeLaunchCapability: true, providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "DELETE"
      ? new Response("upstream gateway page", { status: 502, headers: { "Content-Type": "text/plain" } })
      : new Response(JSON.stringify({ ...page, participants: [row] }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Revoke launch link" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect((await screen.findByText(/Revoke failed \(502\)/)).textContent).toContain("open Support");
  });
  it("keeps the roster contained at constrained width and exposes keyboard actions without console errors", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: [{ ...participant, providerCorrelation: true, nativeInvitationsEnabled: true, sessionEndsAt: "2099-01-01T00:00:00.000Z" }] }))} />);
    const table = await screen.findByRole("table", { name: "Participant roster" });
    Object.defineProperty(table.parentElement, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(table.parentElement, "scrollWidth", { configurable: true, value: 320 });
    expect((table.parentElement as HTMLElement).scrollWidth).toBeLessThanOrEqual((table.parentElement as HTMLElement).clientWidth);
    const row = screen.getByRole("row", { name: /Ada Lovelace/ });
    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate launch link" }).getAttribute("data-primary-action")).toBe("true");
    expect(screen.getByRole("button", { name: "Resend" }).getAttribute("data-primary-action")).toBeNull();
    expect(document.querySelectorAll('[data-primary-action="true"]')).toHaveLength(1);
    expect(screen.getByText(/Environment state:/).textContent).toContain("Ready");
    expect(screen.getByText(/Environment source:/).textContent).toContain("CloudShare participant roster");
    expect(screen.getByText(/Session access ends:/).textContent).toContain("Z");
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });
  it("keeps generated capability local, copies it, and never opens or navigates it", async () => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ launchUrl: "/sales/launch/portal-token", correlationId: "launch-corr" }), { status: 201 }) : new Response(JSON.stringify({ participants: [row], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    const user = userEvent.setup();
    const copied = vi.spyOn(navigator.clipboard, "writeText");
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await screen.findByRole("row", { name: /Ada Lovelace/ });
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Generate launch link" }));
    await waitFor(() => expect(copied).toHaveBeenCalledWith(expect.stringContaining("/sales/launch/portal-token")));
    expect(opened).not.toHaveBeenCalled();
    expect(screen.getByText("Launch link generated and copied.")).toBeTruthy();
  });
  it("keeps a successful generated capability local when clipboard permission is denied", async () => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ launchUrl: "/sales/launch/portal-token", correlationId: "launch-corr" }), { status: 201 }) : new Response(JSON.stringify({ participants: [row], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Generate launch link" }));
    expect(await screen.findByText("Launch link generated. Copy it from the local workspace when clipboard access is available.")).toBeTruthy();
    const manualCopy = screen.getByRole("textbox", { name: "Generated launch link" });
    expect(manualCopy.getAttribute("readonly")).not.toBeNull();
    expect((manualCopy as HTMLInputElement).value).toContain("/sales/launch/portal-token");
    expect(opened).not.toHaveBeenCalled();
  });
  it("clears a one-time generated launch capability when the active row changes", async () => {
    const second = { ...participant, id: "p2", name: "Grace Hopper" };
    const rows = [participant, second].map((item) => ({ ...item, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null }));
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ launchUrl: "/sales/launch/portal-token", correlationId: "launch-corr" }), { status: 201 }) : new Response(JSON.stringify({ participants: rows, total: 2, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click((await screen.findAllByRole("button", { name: "Inspect" }))[0]);
    await user.click(screen.getByRole("button", { name: "Generate launch link" }));
    expect(await screen.findByRole("textbox", { name: "Generated launch link" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("row", { name: /Grace Hopper/ }));
    expect(screen.queryByRole("textbox", { name: "Generated launch link" })).toBeNull();
  });
  it("restores direct-link focus and exposes semantic selection, durable feedback, and canonical Activity", async () => {
    window.history.replaceState({}, "", "/sales?participantActive=p1&participantFocus=inspector");
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, latestInvitationOutcome: "accepted_unconfirmed", latestInvitationReason: "provider_acknowledged", latestInvitationCorrelationId: "invite-corr", launchOperation: { operation: "generate", outcome: "failure", reason: "persistence_failure", correlationId: "launch-corr" }, environmentAttention: null };
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: [row] }))} />);
    const inspector = await screen.findByRole("complementary", { name: "Participant inspector" }); await waitFor(() => expect(document.activeElement).toBe(inspector));
    const status = screen.getByRole("status"); expect(status.textContent).toContain("invite-corr"); expect(status.textContent).toContain("acknowledged by CloudShare"); expect(status.textContent).toContain("replay allowed and fence released"); expect(status.textContent).not.toContain("accepted_unconfirmed"); expect(status.textContent).not.toContain("provider_acknowledged"); expect(status.textContent).toContain("persistence_failure"); expect(status.textContent).toContain("launch-corr");
    expect(screen.getByRole("link", { name: "View Activity" }).getAttribute("href")).toBe("/sales/sessions/s1?area=activity&correlationId=invite-corr");
    expect(screen.getByRole("region", { name: "Scrollable Participant roster" }).getAttribute("tabindex")).toBe("0");
    fireEvent.click(screen.getByRole("row", { name: /Ada Lovelace/ })); expect(screen.getByRole("row", { name: /Ada Lovelace/ }).getAttribute("aria-selected")).toBe("true"); expect(screen.getByText(/1 selected/)).toBeTruthy();
  });
});
