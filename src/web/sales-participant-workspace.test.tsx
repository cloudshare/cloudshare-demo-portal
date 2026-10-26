/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesParticipantWorkspace } from "./sales-participant-workspace";

// Extension entry and its real workspace integration are covered in sales-participant-extension.test.tsx.
vi.mock("./sales-participant-extension", () => ({ SalesParticipantExtension: () => null }));

const participant = { id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", participantRevision: "2026-07-24T08:00:00.000Z", environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" }, primaryAction: "generate_launch", actionAvailability: { invite: { available: true, reason: "available_to_attempt" }, resend: { available: true, reason: "available_to_attempt" }, generate_launch: { available: true, reason: "available_to_attempt" }, revoke_launch: { available: true, reason: "available_to_attempt" }, open_diagnostics: { available: false, reason: "unavailable_for_state" } } } as const;
const page = { participants: [participant], total: 1, offset: 0, limit: 25, hasMore: false };

describe("SalesParticipantWorkspace", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/sales"); });
  it("labels blocked access separately from retained provider participation and saved archive confirmation", async () => {
    const request = vi.fn(async () => Response.json({ ...page, participants: [{ ...participant, sessionCancelled: true, participationStatus: "inProgress", environment: { dimension: "cloudshare_environment", value: "Archived", source: "confirmed_session_cancellation", confirmedAt: "2026-10-26T14:01:42.575Z" } }] }));
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const table = await screen.findByRole("table", { name: "Participant roster" });
    expect(within(table).getByText("Access blocked")).toBeTruthy();
    expect(within(table).getByText("Archived")).toBeTruthy();
    expect(within(table).getByText(/Cancellation confirmation saved/).textContent).toContain("2026-10-26");
    expect(within(table).queryByText("In progress")).toBeNull();
    expect(within(table).queryByText("Concluded")).toBeNull();
    await userEvent.setup().click(within(table).getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
  });
  it.each([0, 1, 2])( "places the inspector directly after the active %s visible row", async (index) => {
    const rows = [0, 1, 2].map((row) => ({ ...participant, id: `p${row + 1}`, name: `Participant ${row + 1}`, email: `p${row + 1}@example.test` }));
    const request = vi.fn(async () => new Response(JSON.stringify({ participants: rows, total: rows.length, offset: 0, limit: 25, hasMore: false })));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const table = await screen.findByRole("table", { name: "Participant roster" });
    const activeRow = within(table).getAllByRole("row")[index + 1];
    await user.click(within(activeRow).getByRole("button", { name: "Inspect" }));
    const detailRow = activeRow.nextElementSibling;
    expect(detailRow?.tagName).toBe("TR");
    expect(detailRow?.querySelector("td")?.getAttribute("colspan")).toBe("5");
    expect(within(detailRow as HTMLElement).getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
  });
  it("toggles the active row control between Inspect and Close", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => new Response(JSON.stringify(page)));
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);

    const inspect = await screen.findByRole("button", { name: "Inspect" });
    await user.click(inspect);

    expect(screen.getByRole("button", { name: "Close" })).toBe(inspect);
    expect(screen.queryByRole("complementary", { name: "Participant inspector" })).not.toBeNull();
    expect(within(screen.getByRole("complementary", { name: "Participant inspector" })).queryByRole("button", { name: "Close" })).toBeNull();

    await user.click(inspect);

    expect(screen.queryByRole("complementary", { name: "Participant inspector" })).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect" })).toBe(inspect);
  });
  it("registers one eligible contact once, rereads the canonical page, and inspects the new Participant", async () => {
    const user = userEvent.setup();
    const registered = { ...participant, id: "registered-1", name: "Grace Hopper", email: "grace@example.test" };
    let reread = false;
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/participants/add")) { reread = true; return new Response(JSON.stringify({ outcome: "registered", participantId: registered.id, contactId: "contact-1" }), { status: 201 }); }
      if (url.includes("/participants/invite")) throw new Error("invite must not be called");
      return new Response(JSON.stringify(reread ? { participants: [registered], total: 1, offset: 0, limit: 25, hasMore: false } : { participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const contact = await screen.findByRole("option", { name: /Grace Hopper/ });
    await user.selectOptions(screen.getByRole("combobox", { name: "Eligible Opportunity Contact" }), contact);
    const register = screen.getByRole("button", { name: "Add participant" });
    await user.click(register);
    await user.click(register);
    await screen.findByRole("row", { name: /Grace Hopper/ });
    const posts = request.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).includes("participants/add"));
    expect(posts.length).toBe(1);
    expect(String(posts[0]?.[1]?.body)).toContain('"kind":"existingContact"');
    expect(request.mock.calls.some(([url]) => String(url).includes("/participants/invite"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
  });
  it("adds an ad hoc person once and rereads the canonical Participant", async () => {
    const user = userEvent.setup();
    const added = { ...participant, id: "ad-hoc-1", name: "Katherine Johnson", email: "katherine@example.test" };
    let addedOnce = false;
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/participants/add")) { addedOnce = true; return new Response(JSON.stringify({ outcome: "registered", participantId: added.id, contactId: "contact-ad-hoc" }), { status: 201 }); }
      if (url.includes("/participants/invite")) throw new Error("invite must not be called");
      return new Response(JSON.stringify(addedOnce ? { participants: [added], total: 1, offset: 0, limit: 25, hasMore: false, eligibleContacts: [] } : { participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-ad-hoc", name: "Available Contact", email: "available@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByLabelText(/New person/));
    await user.type(screen.getByLabelText("First name"), "Katherine");
    await user.type(screen.getByLabelText("Last name"), "Johnson");
    await user.type(screen.getByLabelText("Email"), "katherine@example.test");
    const add = screen.getByRole("button", { name: "Add participant" });
    await user.click(add); await user.click(add);
    await screen.findByRole("row", { name: /Katherine Johnson/ });
    const posts = request.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).includes("/participants/add"));
    expect(posts).toHaveLength(1);
    expect(String(posts[0]?.[1]?.body)).toContain('"kind":"adHoc"');
    expect(String(posts[0]?.[1]?.body)).toContain('"commandId"');
    expect(request.mock.calls.some(([url]) => String(url).includes("/participants/invite"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
  });
  it("blocks retry after an uncertain participant-add response and offers read-only evidence refresh", async () => {
    const user = userEvent.setup();
    const bodies: string[] = [];
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/participants/add")) {
        bodies.push(String(init?.body));
        return new Response(JSON.stringify({ outcome: "needs_attention", code: "participant_add_no_replay", error: "Provider outcome is ambiguous.", correlationId: "corr-ambiguous" }), { status: 409 });
      }
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    await screen.findByText(/It will not be replayed\. A read-only status check is scheduled for .*Z\./);
    expect(screen.queryByRole("button", { name: /Retry participant/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Add participant" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Support diagnostics" }).getAttribute("href")).toContain("correlationId=corr-ambiguous");
    await user.click(screen.getByRole("button", { name: "Check CloudShare status now" }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method !== "POST").length).toBeGreaterThan(1));
    expect(bodies).toHaveLength(2);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/participants/add"))).toHaveLength(1);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("/participants/add/reconcile"))).toHaveLength(1);
  });

  it("unlocks Add for a different participant without replaying the failed target", async () => {
    const user = userEvent.setup(); const addBodies: string[] = [];
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/participants/add")) {
        addBodies.push(String(init?.body));
        return addBodies.length === 1
          ? new Response(JSON.stringify({ outcome: "needs_attention", code: "participant_add_no_replay", correlationId: "corr-user4", commandId: "11111111-1111-4111-8111-111111111111" }), { status: 409 })
          : new Response(JSON.stringify({ outcome: "registered", participantId: "participant-5" }), { status: 201 });
      }
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-4", name: "Test User 4", email: "user4@example.test" }, { id: "contact-5", name: "Test User 5", email: "user5@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const select = await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" });
    await user.selectOptions(select, "contact-4");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    await screen.findByText(/It will not be replayed\. A read-only status check is scheduled for .*Z\./);
    expect((screen.getByRole("button", { name: "Add participant" }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(select, "contact-5");
    expect(screen.queryByText("corr-user4")).toBeNull();
    expect((screen.getByRole("button", { name: "Add participant" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    await waitFor(() => expect(addBodies).toHaveLength(2));
    expect(JSON.parse(addBodies[0]).person.contactId).toBe("contact-4");
    expect(JSON.parse(addBodies[1]).person.contactId).toBe("contact-5");
  });

  it("automatically retries with bounded backoff only when the provider write was not dispatched", async () => {
    const user = userEvent.setup(); const bodies: string[] = [];
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/participants/add")) { bodies.push(String(init?.body)); return bodies.length === 1 ? new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched", correlationId: "corr-safe" }), { status: 503 }) : new Response(JSON.stringify({ outcome: "registered", participantId: "p-safe" }), { status: 201 }); }
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    await screen.findByText(/Automatic OAuth retry 1 of 3 is scheduled for .*Z\./);
    expect(screen.getByRole("link", { name: "Support diagnostics" }).getAttribute("href")).toContain("correlationId=corr-safe");
    expect((screen.getByRole("button", { name: "Add participant" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Retry participant add now" })).toBeTruthy();
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 4_000 });
    expect(JSON.parse(bodies[0]).commandId).not.toBe(JSON.parse(bodies[1]).commandId);
  });

  it("does not schedule an automatic participant retry after the Session workspace unmounts", async () => {
    const user = userEvent.setup(); let release!: (response: Response) => void; const posts: string[] = [];
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/participants/add")) { posts.push(String(init?.body)); return pending; }
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    const view = render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    view.unmount();
    await act(async () => { release(new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched" }), { status: 503 })); await pending; });
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(posts).toHaveLength(1);
  });

  it("clears a canceled automatic retry when the workspace changes Session", async () => {
    const user = userEvent.setup(); const posts: string[] = [];
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/participants/add")) { posts.push(url); return new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched", correlationId: "old-session-correlation" }), { status: 503 }); }
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    const view = render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    await screen.findByText(/Automatic OAuth retry 1 of 3/);
    view.rerender(<SalesParticipantWorkspace sessionId="s2" active request={request} />);
    await waitFor(() => expect(screen.queryByText("old-session-correlation")).toBeNull());
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    expect((screen.getByRole("button", { name: "Add participant" }) as HTMLButtonElement).disabled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(posts).toHaveLength(1);
  });

  it("ignores a pending participant response and unlocks Add when the workspace changes Session", async () => {
    const user = userEvent.setup(); let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const request = vi.fn(async (url: string) => url.endsWith("/participants/add") ? pending : new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] })));
    const view = render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    view.rerender(<SalesParticipantWorkspace sessionId="s2" active request={request} />);
    await act(async () => { release(new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched", correlationId: "old-pending-correlation" }), { status: 503 })); await pending; });
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    expect((screen.getByRole("button", { name: "Add participant" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("old-pending-correlation")).toBeNull();
  });

  it("refreshes a legacy no-replay command into explicit retry-safe state without adding a participant", async () => {
    const user = userEvent.setup(); const posts: Array<{ url: string; body: string }> = [];
    const durableCommandId = "11111111-1111-4111-8111-111111111111";
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/participants/add")) { posts.push({ url, body: String(init?.body) }); return new Response(JSON.stringify({ outcome: "needs_attention", code: "participant_add_no_replay", correlationId: "corr-legacy", commandId: durableCommandId }), { status: 409 }); }
      if (url.endsWith("/participants/add/reconcile")) { posts.push({ url, body: String(init?.body) }); return new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched", correlationId: "corr-legacy", commandId: durableCommandId }), { status: 503 }); }
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" }), "contact-1");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    await screen.findByText(/It will not be replayed\. A read-only status check is scheduled for .*Z\./);
    await user.click(screen.getByRole("button", { name: "Check CloudShare status now" }));
    await screen.findByText("CloudShare absence and pre-dispatch evidence agree. Manual retry is safe.");
    expect(screen.getByRole("button", { name: "Retry participant add" })).toBeTruthy();
    expect(posts).toHaveLength(2);
    expect(posts[1].url).toContain("/reconcile");
    expect(JSON.parse(posts[1].body).commandId).toBe(durableCommandId);
    expect(Object.keys(JSON.parse(posts[1].body))).toEqual(["commandId"]);
  });

  it("automatically reconciles ambiguity before scheduling the first long recovered add", async () => {
    const calls: string[] = []; const commandId = "11111111-1111-4111-8111-111111111111";
    const request = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/participants/add/reconcile")) return new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched", correlationId: "corr-recovered" }), { status: 503 });
      if (url.endsWith("/participants/add")) return calls.filter((value) => value.endsWith("/participants/add")).length === 1
        ? new Response(JSON.stringify({ outcome: "needs_attention", code: "participant_add_no_replay", correlationId: "corr-ambiguous", commandId }), { status: 409 })
        : new Response(JSON.stringify({ outcome: "registered", participantId: "p-recovered" }), { status: 201 });
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    const select = await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" });
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T17:00:00.000Z"));
    fireEvent.change(select, { target: { value: "contact-1" } }); fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/read-only status check is scheduled for 2026-09-13T17:02:00.000Z/)).toBeTruthy();
    expect(calls.filter((value) => value.endsWith("/participants/add"))).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls.filter((value) => value.endsWith("/participants/add/reconcile"))).toHaveLength(1);
    expect(screen.getByText(/Recovered add retry 1 of 4 is scheduled for 2026-09-13T17:04:00.000Z/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls.filter((value) => value.endsWith("/participants/add"))).toHaveLength(2);
  });

  it.each(["unmount", "session change"])("does not schedule a recovered add when reconciliation finishes after %s", async (exit) => {
    let release!: (response: Response) => void; const pendingReconcile = new Promise<Response>((resolve) => { release = resolve; }); const calls: string[] = [];
    const request = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/participants/add/reconcile")) return pendingReconcile;
      if (url.endsWith("/participants/add")) return new Response(JSON.stringify({ outcome: "needs_attention", code: "participant_add_no_replay", correlationId: "corr-stale", commandId: "11111111-1111-4111-8111-111111111111" }), { status: 409 });
      return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false, eligibleContacts: [{ id: "contact-1", name: "Grace Hopper", email: "grace@example.test" }] }));
    });
    const view = render(<SalesParticipantWorkspace sessionId="s1" active request={request} />); const select = await screen.findByRole("combobox", { name: "Eligible Opportunity Contact" });
    vi.useFakeTimers(); fireEvent.change(select, { target: { value: "contact-1" } }); fireEvent.click(screen.getByRole("button", { name: "Add participant" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls.filter((value) => value.endsWith("/participants/add/reconcile"))).toHaveLength(1);
    if (exit === "unmount") view.unmount(); else view.rerender(<SalesParticipantWorkspace sessionId="s2" active request={request} />);
    await act(async () => { release(new Response(JSON.stringify({ outcome: "rejected", code: "participant_add_retryable", dispatchOutcome: "not_dispatched", correlationId: "corr-stale" }), { status: 503 })); await pendingReconcile; await vi.advanceTimersByTimeAsync(120_000); });
    expect(calls.filter((value) => value.endsWith("/participants/add"))).toHaveLength(1);
  });

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
    await screen.findByText("No Participants match this page or search.");
    expect(screen.queryByText("Register an eligible Opportunity Contact to add the first Participant.")).toBeNull();
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
  it("closes the inspector and clears its target when that Participant leaves the page", async () => {
    const second = { ...participant, id: "p2", name: "Grace Hopper" };
    const request = vi.fn(async (url: string) => new Response(JSON.stringify({ participants: url.includes("query=") ? [second] : [participant], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Search Participants" }), "g");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Participant inspector" })).toBeNull());
    await waitFor(() => expect(new URL(window.location.href).searchParams.get("participantActive")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Participants" })));
  });
  it("shows a visible status when the bounded roster fetch fails", async () => {
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => { throw new Error("network down"); }} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be loaded"));
    expect(screen.queryByText("No Participants are registered for this Sales Session.")).toBeNull();
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
    const status = await screen.findByText(/CloudShare acknowledged the invitation; delivery remains unconfirmed. The same command will not run again. The fence is released; an administrator may start a new Resend/);
    expect(status.textContent).toContain("corr-unconfirmed");
    expect(status.textContent).not.toContain("retained");
    expect(status.textContent).not.toContain("Replay is allowed");
    expect(status.textContent).not.toBe("Completed. Correlation corr-unconfirmed.");
  });
  it("exposes every disabled action reason through described visible text", async () => {
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inspect" }));
    const inspector = screen.getByRole("complementary", { name: "Participant inspector" });
    for (const button of within(inspector).getAllByRole("button").filter((candidate) => candidate.hasAttribute("disabled"))) {
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
  it("restores focus to an enabled current action after revoke disables the originating control", async () => {
    let revoked = false;
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", activeLaunchCapability: true, providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") { revoked = true; return new Response(JSON.stringify({ correlationId: "corr-revoke" }), { status: 200 }); }
      return new Response(JSON.stringify({ ...page, participants: [{ ...row, activeLaunchCapability: !revoked, actionAvailability: { ...row.actionAvailability, revoke_launch: revoked ? { available: false, reason: "no_active_launch" } : { available: true, reason: "available_to_attempt" } } }] }), { status: 200 });
    });
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Revoke launch link" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const original = await screen.findByRole("button", { name: "Revoke launch link" });
    await waitFor(() => expect((original as HTMLButtonElement).disabled).toBe(true));
    const expected = screen.getByRole("button", { name: "Generate launch link" });
    await waitFor(() => expect(document.activeElement).toBe(expected));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });
  it.each(["invitation_blocked", "precondition_failed", "command_id_mismatch"])("explains a competing invitation fence for %s", async (code) => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, currentCommandId: null, invitationOutcome: null, activeLaunchCapability: false, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ code }), { status: 409 })
      : new Response(JSON.stringify({ ...page, participants: [row] }), { status: 200 }));
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Resend" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Another invitation command is already in progress or awaiting confirmation");
    expect(status.textContent).toContain("Refresh Participant state before starting another invitation action");
    expect(status.textContent).not.toContain("Action failed");
    expect(status.textContent).not.toContain(code);
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
  it("clears a one-time generated launch capability when the session changes", async () => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", providerCorrelation: true, nativeInvitationsEnabled: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: null, environmentAttention: null };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ launchUrl: "/sales/launch/portal-token", correlationId: "launch-corr" }), { status: 201 }) : new Response(JSON.stringify({ participants: [row], total: 1, offset: 0, limit: 25, hasMore: false }), { status: 200 }));
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup();
    const view = render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
    await user.click(await screen.findByRole("button", { name: "Inspect" }));
    await user.click(screen.getByRole("button", { name: "Generate launch link" }));
    expect(await screen.findByRole("textbox", { name: "Generated launch link" })).toBeTruthy();
    view.rerender(<SalesParticipantWorkspace sessionId="s2" active request={request} />);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Generated launch link" })).toBeNull());
  });
  it("restores direct-link focus and exposes semantic selection, durable feedback, and canonical Activity", async () => {
    window.history.replaceState({}, "", "/sales?participantActive=p1&participantFocus=inspector");
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, latestInvitationOutcome: "accepted_unconfirmed", latestInvitationReason: null, latestInvitationCorrelationId: "invite-corr", launchOperation: { operation: "generate", outcome: "failure", reason: "persistence_failure", correlationId: "launch-corr" }, environmentAttention: null };
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: [row] }))} />);
    const inspector = await screen.findByRole("complementary", { name: "Participant inspector" }); await waitFor(() => expect(document.activeElement).toBe(inspector));
    const status = screen.getByRole("status"); expect(status.textContent).toContain("invite-corr"); expect(status.textContent).toContain("acknowledged the invitation"); expect(status.textContent).toContain("same command will not run again"); expect(status.textContent).toContain("fence is released"); expect(status.textContent).toContain("administrator may start a new Resend"); expect(status.textContent).not.toContain("Replay is allowed"); expect(status.textContent).not.toContain("accepted_unconfirmed"); expect(status.textContent).not.toContain("persistence_failure"); expect(status.textContent).toContain("Certalis could not save the launch operation"); expect(status.textContent).toContain("launch-corr");
    expect(screen.getByRole("link", { name: "View Activity" }).getAttribute("href")).toBe("/sales/sessions/s1?area=activity&correlationId=invite-corr");
    expect(screen.getByRole("region", { name: "Scrollable Participant roster" }).getAttribute("tabindex")).toBe("0");
    fireEvent.click(screen.getByRole("row", { name: /Ada Lovelace/ })); expect(screen.getByRole("row", { name: /Ada Lovelace/ }).getAttribute("aria-selected")).toBe("true"); expect(screen.getByText(/1 selected/)).toBeTruthy();
  });

  it.each([
    ["confirmed", null, "CloudShare confirmed the invitation."],
    ["confirmed_by_reconciliation", null, "Certalis confirmed the invitation during a CloudShare roster check."],
    ["accepted_unconfirmed", null, "The same command will not run again. The fence is released; an administrator may start a new Resend."],
    ["confirmation_required", "confirmation_required", "CloudShare delivery could not be confirmed. The same command will not run again while its confirmation fence remains in place."],
    ["no_replay", "ambiguous_after_dispatch", "The provider result is ambiguous. The same command will not run again; open Support before starting another invitation action."],
    ["failed_retryable", "not_dispatched", "The invitation request did not reach CloudShare."],
    ["failed_retryable", "provider_rejected", "CloudShare rejected the invitation request."],
    ["failed_retryable", "failed_retryable", "A newly initiated invitation action may be attempted."],
    ["failed_retryable", "stale_revision", "The Participant changed before the invitation action could start."],
    ["failed_retryable", "blocked_by_fence", "Another invitation command is already in progress or awaiting confirmation."],
  ] as const)("renders controlled durable invitation feedback for %s / %s", async (outcome, reason, expected) => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, latestInvitationOutcome: outcome, latestInvitationReason: reason, latestInvitationCorrelationId: "invite-corr", launchOperation: null, environmentAttention: null };
    window.history.replaceState({}, "", "/sales?participantActive=p1&participantFocus=inspector");
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: [row] }))} />);
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).toContain(expected);
    for (const token of ["confirmed_by_reconciliation", "accepted_unconfirmed", "confirmation_required", "no_replay", "failed_retryable", "not_dispatched", "provider_rejected", "ambiguous_after_dispatch", "stale_revision", "blocked_by_fence"]) expect(text).not.toContain(token);
  });

  it.each([
    ["generate", "success", null, "Launch link generation succeeded."],
    ["generate", "failure", "persistence_failure", "Launch link generation failed. Certalis could not save the launch operation."],
    ["revoke", "success", null, "Launch link revocation succeeded."],
    ["revoke", "failure", "persistence_failure", "Launch link revocation failed. Certalis could not save the launch operation."],
  ] as const)("renders controlled durable launch feedback for %s / %s", async (operation, outcome, reason, expected) => {
    const row = { ...participant, sessionEndsAt: "2099-01-01T00:00:00.000Z", nativeInvitationsEnabled: true, providerCorrelation: true, activeLaunchCapability: false, currentCommandId: null, invitationOutcome: null, launchOperation: { operation, outcome, reason, correlationId: "launch-corr" }, environmentAttention: null };
    window.history.replaceState({}, "", "/sales?participantActive=p1&participantFocus=inspector");
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify({ ...page, participants: [row] }))} />);
    const text = (await screen.findByRole("status")).textContent ?? "";
    expect(text).toContain(expected);
    for (const token of ["generate", "revoke", "success", "failure", "persistence_failure"]) expect(text).not.toContain(token);
  });
});
