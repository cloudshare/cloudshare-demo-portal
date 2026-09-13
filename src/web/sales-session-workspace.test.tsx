/** @vitest-environment jsdom */
import React, { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionWorkspace } from "./sales-session-workspace";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const data = { summary: { id: "session-1", sessionName: "Acme enablement", revision: 3, start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "Europe/London", operation: { value: "correlated", source: "certalis_persistence" }, experience: { value: "notStarted", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-07-24T08:59:00.000Z" } }, participants: [{ id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" }, primaryAction: "resend", actionAvailability: { invite: { available: false, reason: "invitation_already_sent" }, resend: { available: true, reason: "available_to_attempt" }, generate_launch: { available: true, reason: "available_to_attempt" }, revoke_launch: { available: false, reason: "no_active_launch" }, open_diagnostics: { available: false, reason: "unavailable_for_state" } } }], total: 1, offset: 0, limit: 25, hasMore: false, activity: [{ occurredAt: "2026-07-23T09:00:00.000Z", kind: "session_provision", summary: "Sales Session provision completed.", outcome: "success", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" }, correlationId: "corr-1" }], details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement item", invitationMode: "Sales Pros and participants" } };

describe("Sales Session workspace", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("refreshes an estimated workspace, exposes failure support, and retries with a local reread", async () => {
    const user = userEvent.setup();
    let releaseFailure!: () => void;
    const pending = new Promise<void>((resolve) => { releaseFailure = resolve; });
    let automaticPosts = 0;
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const fresh = { ...data, summary: { ...data.summary, experience: { value: "inProgress", source: "cloudshare_v4_sales_list", freshness: "fresh", observedAt: "2026-07-24T09:01:00.000Z" } } };
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/workspace")) return new Response(JSON.stringify(automaticPosts > 1 ? fresh : stale), { status: 200 });
      if (init?.method === "POST") {
        automaticPosts += 1;
        if (automaticPosts === 1) { await pending; return new Response(JSON.stringify({ error: "CloudShare unavailable", correlationId: "refresh-fail" }), { status: 503 }); }
        return new Response(JSON.stringify({ correlationId: "refresh-ok", rows: [{ id: "session-1", status: "inProgress" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    releaseFailure();
    await screen.findByText("CloudShare unavailable");
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).toContain("refresh-fail");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("CloudShare status refreshed.");
    expect(automaticPosts).toBe(2);
    expect((screen.getByRole("button", { name: "Verify now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not loop when an automatic refresh returns the same predicted snapshot", async () => {
    let posts = 0;
    const predicted = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/workspace")) return new Response(JSON.stringify(predicted), { status: 200 });
      if (init?.method === "POST") { posts += 1; return new Response(JSON.stringify({ rows: [], total: 0, progress: { state: "complete" } }), { status: 200 }); }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toBe(1);
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).toBe("/sales?tab=support");
  });

  it("keeps automatic-refresh and Verify support correlations independent", async () => {
    const user = userEvent.setup(); let posts = 0;
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/workspace")) return new Response(JSON.stringify(stale), { status: 200 });
      if (String(input).includes("/verify")) return new Response(JSON.stringify({ correlationId: "verify-independent", experienceStatus: "inProgress", observedAt: "2026-07-24T09:01:00.000Z", freshness: "fresh", source: "cloudshare_v4_get_sales" }), { status: 200 });
      if (init?.method === "POST") { posts += 1; return new Response(JSON.stringify({ error: "refresh unavailable", correlationId: "refresh-independent" }), { status: 503 }); }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).toContain("refresh-independent");
    await user.click(screen.getByRole("button", { name: "Verify now" }));
    await screen.findByText(/Verified from CloudShare/);
    const supportLinks = screen.getAllByRole("link", { name: "Open Sales support" }).map((link) => link.getAttribute("href"));
    expect(supportLinks).toContain("/sales?tab=support&correlationId=refresh-independent");
    expect(supportLinks).toContain("/sales?tab=support&correlationId=verify-independent");
    expect(posts).toBe(1);
  });

  it("verifies one Experience, shows durable progress, and preserves the operation dimension", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/workspace")) return new Response(JSON.stringify(data), { status: 200 });
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ correlationId: "verify-1", experienceStatus: "inProgress", observedAt: "2026-07-24T09:01:00.000Z", freshness: "fresh", source: "cloudshare_v4_get_sales" }), { status: 200 });
    });
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await user.click(screen.getByRole("button", { name: "Verify now" }));
    expect((await screen.findByRole("status")).textContent).toContain("Verified from CloudShare: inProgress");
    expect(screen.getAllByText("Correlated").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/verify"), expect.objectContaining({ method: "POST" }));
  });

  it("keeps the summary safe after invalid or failed verification", async () => {
    const user = userEvent.setup();
    let verifyCalls = 0;
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/participants?")) return new Response(JSON.stringify(data), { status: 200 });
      if (String(input).includes("/workspace")) return new Response(JSON.stringify(data), { status: 200 });
      verifyCalls += 1;
      return verifyCalls === 1
        ? new Response(JSON.stringify({ correlationId: "verify-bad", experienceStatus: "unknown", freshness: "fresh", source: "wrong" }), { status: 200 })
        : new Response(JSON.stringify({ error: "CloudShare unavailable", correlationId: "verify-fail" }), { status: 503 });
    });
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await user.click(screen.getByRole("button", { name: "Verify now" }));
    expect((await screen.findByRole("status")).textContent).toContain("incomplete verification observation");
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).toContain("correlationId=verify-bad");
    expect(screen.getAllByText("Correlated").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Verify now" }));
    expect((await screen.findByRole("status")).textContent).toContain("CloudShare unavailable");
    expect(screen.getAllByText("Correlated").length).toBeGreaterThan(0);
  });

  it("opens Participants by default, routes local areas, and links correlation to authorized Support", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions&queue=history&offset=25" />);

    expect(await screen.findByRole("heading", { name: "Acme enablement" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Participants" })).not.toBeNull();
    expect(document.body.textContent).toContain("2026-07-24T09:00:00.000Z · Europe/London");
    expect(screen.getByRole("link", { name: "Activity" }).getAttribute("href")).toContain("area=activity");
    expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toContain("area=details");
    expect(screen.getByRole("link", { name: "Back to Sessions" }).getAttribute("href")).toBe("/sales?tab=sessions&queue=history&offset=25");
  });

  it("invokes the browser fetch interface with its required Window receiver", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(function (this: Window) {
      if (this !== window) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
    });

    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("heading", { name: "Acme enablement" })).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("renders an understandable safe state for an unavailable Session", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "This Sales Session is unavailable for this Customer." }), { status: 404 }));
    render(<SalesSessionWorkspace sessionId="missing" area="activity" queueHref="/sales?tab=sessions" />);
    expect((await screen.findByRole("alert")).textContent).toContain("This Sales Session is unavailable for this Customer.");
    expect(screen.getByRole("link", { name: "Back to Sessions" })).not.toBeNull();
  });

  it("removes protected workspace content and replaces history on an expired Session request", async () => {
    window.history.replaceState({}, "", "/sales/sessions/session-1?area=activity&from=%2Fsales%3Ftab%3Dsessions");
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Session expired" }), { status: 401 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByText("Your session has expired. Sign in again to continue.")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Activity" })).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  it.each(["participants", "activity", "details"] as const)("moves focus to the %s heading after a fresh route load", async (area) => {
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area={area} queueHref="/sales?tab=sessions" />);
    const firstHeading = await screen.findByRole("heading", { name: area[0].toUpperCase() + area.slice(1) });
    await waitFor(() => expect(document.activeElement).toBe(firstHeading));
    expect(firstHeading.getAttribute("tabindex")).toBe("-1");
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    const heading = await screen.findByRole("heading", { name: "Activity" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("does not steal focus again when the loaded workspace rerenders", async () => {
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    const initialHeading = await screen.findByRole("heading", { name: "Participants" });
    await waitFor(() => expect(document.activeElement).toBe(initialHeading));
    const laterControl = document.createElement("button");
    document.body.append(laterControl);
    laterControl.focus();

    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(document.activeElement).toBe(laterControl);
    laterControl.remove();
  });

  it("keeps the actionable Certalis reason in a needs-attention summary", async () => {
    const needsAttention = { ...data, summary: { ...data.summary, operation: { value: "needs_attention", source: "certalis_persistence", reason: "Participant correlation requires support.", retry: "unsafe_requires_support", dimension: "certalis_operation" } } };
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(needsAttention), { status: 200 })));

    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByText("Participant correlation requires support.")).not.toBeNull();
  });

  it("presents the bounded Participant table and inspector entry point", async () => {
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("table", { name: "Participant roster" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Participant" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Environment source" })).not.toBeNull();
    expect(screen.getByText("Bounded Participant workspace page.")).not.toBeNull();
  });

  it("opens the persistent Participant inspector from a row and returns on Escape", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("table", { name: "Participant roster" });
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Participant inspector" })).toBeNull();
  });

  it("explains persisted Participant Environment attention without exposing raw evidence", async () => {
    const attentionData = {
      ...data,
      participants: [{
        ...data.participants[0],
        environment: { value: null, source: "not_observed" },
        environmentAttention: {
          reason: "Multiple matching Participant Environments require support review.",
          source: "Certalis Environment correlation check",
        },
      }],
    };
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(attentionData), { status: 200 })));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByText("CloudShare Environment state has not been observed")).not.toBeNull();
    expect(screen.queryByText("Multiple matching Participant Environments require support review.")).toBeNull();
    expect(screen.queryByText(/Certalis Environment correlation check/)).toBeNull();
    expect(screen.getByText("CloudShare Environment state has not been observed")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/Bearer|provider response/);
  });

  it("summarizes grouped Activity without repeating diagnostic step or subject details", async () => {
    const repeatedActivity = {
      ...data,
      activity: [
        data.activity[0],
        { ...data.activity[0], occurredAt: "2026-07-23T09:02:00.000Z" },
        { ...data.activity[0], occurredAt: "2026-07-23T09:04:00.000Z", correlationId: "corr-2" },
      ],
    };
    const responseBody = { ...repeatedActivity, activityGroups: [
      { workflowId: "workflow-2", summary: "Sales Session provision completed.", outcome: "success", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:04:00.000Z", lastAt: "2026-07-23T09:04:00.000Z", count: 1, correlationId: "corr-2", steps: [{ label: "Sales Session provision completed.", outcome: "success", occurredAt: "2026-07-23T09:04:00.000Z" }], diagnosticRecords: [{ correlationId: "corr-2", occurredAt: "2026-07-23T09:04:00.000Z" }] },
      { workflowId: "workflow-1", summary: "Sales Session provision completed.", outcome: "success", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:00:00.000Z", lastAt: "2026-07-23T09:02:00.000Z", count: 2, correlationId: "corr-1", steps: [{ label: "OAuth token acquired.", outcome: "success", occurredAt: "2026-07-23T09:00:00.000Z" }, { label: "Sales Session provision completed.", outcome: "success", occurredAt: "2026-07-23T09:02:00.000Z" }], diagnosticRecords: [{ correlationId: "corr-1", occurredAt: "2026-07-23T09:00:00.000Z" }] },
    ] };
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("list", { name: "Sales Session activity timeline" })).not.toBeNull();
    expect(screen.queryByText(/workflow steps?/)).toBeNull();
    expect(screen.queryByText("OAuth token acquired.")).toBeNull();
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toContain("2026-07-23T09:00:00.000Z");
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toContain("2026-07-23T09:04:00.000Z");
    expect(screen.queryByText(/diagnostic record/)).toBeNull();
    const supportLinks = screen.getAllByRole("link", { name: "Open Sales support investigation" });
    expect(supportLinks).toHaveLength(2);
    expect(supportLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/sales?tab=support&correlationId=corr-2",
      "/sales?tab=support&correlationId=corr-1",
    ]);
    expect(document.querySelectorAll("a[href*='source='], a[href*='subject='], a[href*='operation='], a[href*='surface='], a[href*='filter=']")).toHaveLength(0);
    expect(screen.getAllByText("Actor: Sales admin")).toHaveLength(2);
    expect(screen.queryByText("Subject: This Sales Session")).toBeNull();
    expect(screen.getByText(/Activity shows ordinary operational metadata only/)).not.toBeNull();
  });

  it("keeps retained Activity local-only when its status snapshot is stale", async () => {
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } }, activityGroups: [{ workflowId: "local", summary: "Local activity", outcome: "success", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:00:00.000Z", lastAt: "2026-07-23T09:00:00.000Z", count: 1, correlationId: "corr-local", steps: [{ label: "Local activity", outcome: "success", occurredAt: "2026-07-23T09:00:00.000Z" }], diagnosticRecords: [] }] };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(stale), { status: 200 })));
    render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("list", { name: "Sales Session activity timeline" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/workspace");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("refresh?mode=automatic");
  });

  it("settles an in-flight non-Activity refresh safely when entering Activity", async () => {
    let resolveRefresh!: (value: Response) => void;
    const refreshPending = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const initial = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("refresh?mode=automatic")) return refreshPending;
      if (init?.method === "POST") return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      return new Response(JSON.stringify(initial), { status: 200 });
    });
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("refresh?mode=automatic"))).toBe(true));
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    expect(screen.getByRole("navigation", { name: "Session workspace areas" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Activity" })).not.toBeNull();
    resolveRefresh(new Response(JSON.stringify({ correlationId: "refresh-1" }), { status: 200 }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/workspace") && fetchMock.mock.calls.length > 1)).toBe(true));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Activity" })).not.toBeNull());
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(1);
  });

  it("owns refresh by non-Activity area when leaving and returning to Activity", async () => {
    let resolvePost!: (value: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const fresh = { ...data, summary: { ...data.summary, experience: { value: "inProgress", source: "cloudshare_v4_sales_list", freshness: "fresh", observedAt: "2026-07-24T09:01:00.000Z" } } };
    let workspaceReads = 0;
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("refresh?mode=automatic")) return post;
      if (url.includes("/workspace")) return new Response(JSON.stringify(workspaceReads++ === 0 ? stale : fresh), { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      return new Response(JSON.stringify(stale), { status: 200 });
    });
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Activity" });
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic")).length).toBe(1));
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    expect(screen.getByRole("heading", { name: "Activity" })).not.toBeNull();
    resolvePost(new Response(JSON.stringify({ correlationId: "refresh-ok" }), { status: 200 }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/workspace")).length).toBe(2));
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Participants" })).not.toBeNull());
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(1);
  });

  it("keeps a failed owned refresh actionable after returning from Activity", async () => {
    let rejectPost!: (reason?: unknown) => void;
    const post = new Promise<Response>((_, reject) => { rejectPost = reject; });
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("refresh?mode=automatic")) return post;
      if (String(input).includes("/workspace")) return new Response(JSON.stringify(stale), { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      return new Response(JSON.stringify(stale), { status: 200 });
    });
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Participants" });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(1));
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    await act(async () => { rejectPost(new Error("CloudShare unavailable")); });
    await screen.findByText("CloudShare unavailable");
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });

  it("clears the refresh owner without updating state after unmount", async () => {
    let resolvePost!: (value: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    vi.spyOn(window, "fetch").mockImplementation(async (input) => String(input).includes("refresh?mode=automatic") ? post : new Response(JSON.stringify(stale), { status: 200 }));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Participants" });
    await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(3));
    rendered.unmount();
    resolvePost(new Response(JSON.stringify({ correlationId: "refresh-ok" }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("settles StrictMode automatic refresh success and retry without a stuck owner", async () => {
    let posts = 0;
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const fresh = { ...data, summary: { ...data.summary, experience: { value: "inProgress", source: "cloudshare_v4_sales_list", freshness: "fresh", observedAt: "2026-07-24T09:01:00.000Z" } } };
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/workspace")) return new Response(JSON.stringify(posts >= 1 ? fresh : stale), { status: 200 });
      if (init?.method === "POST") { posts += 1; return new Response(JSON.stringify({ correlationId: `strict-${posts}` }), { status: 200 }); }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    render(<StrictMode><SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" /></StrictMode>);
    await screen.findByRole("heading", { name: "Participants" });
    await screen.findByText("CloudShare status refreshed.");
    expect(posts).toBe(1);
    expect((screen.getByRole("button", { name: "Verify now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("ignores StrictMode refresh failure from a replaced session", async () => {
    let resolvePost!: (value: Response) => void;
    const post = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    vi.spyOn(window, "fetch").mockImplementation(async (input) => String(input).includes("refresh?mode=automatic") ? post : new Response(JSON.stringify(stale), { status: 200 }));
    const rendered = render(<StrictMode><SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" /></StrictMode>);
    await screen.findByRole("heading", { name: "Participants" });
    rendered.rerender(<StrictMode><SalesSessionWorkspace sessionId="session-2" area="participants" queueHref="/sales?tab=sessions" /></StrictMode>);
    await act(async () => { resolvePost(new Response(JSON.stringify({ correlationId: "old-refresh" }), { status: 200 })); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("heading", { name: "Acme enablement" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Participants" })).not.toBeNull();
  });

  it("remounts session-owned state when an automatic refresh crosses session identity", async () => {
    let resolveOld!: (value: Response) => void;
    const oldPost = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const stale = { ...data, summary: { ...data.summary, sessionName: "Old session", experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const next = { ...data, summary: { ...data.summary, id: "session-2", sessionName: "New session" } };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("refresh?mode=automatic")) return oldPost;
      if (url.includes("session-2")) return new Response(JSON.stringify(next), { status: 200 });
      if (url.includes("/workspace")) return new Response(JSON.stringify(stale), { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
      return new Response(JSON.stringify(next), { status: 200 });
    });
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Old session" });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(1));
    rendered.rerender(<SalesSessionWorkspace sessionId="session-2" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "New session" });
    expect(screen.queryByRole("heading", { name: "Old session" })).toBeNull();
    expect((screen.getByRole("button", { name: "Verify now" }) as HTMLButtonElement).disabled).toBe(false);
    resolveOld(new Response(JSON.stringify({ correlationId: "old-refresh" }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("heading", { name: "New session" })).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(1);
  });

  it("ignores a replaced session workspace 401 without expiring the new session", async () => {
    let resolveOld!: (value: Response) => void;
    const oldLoad = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const next = { ...data, summary: { ...data.summary, id: "session-2", sessionName: "Replacement session" } };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => String(input).includes("session-1") ? oldLoad : new Response(JSON.stringify(next), { status: 200 }));
    router.replace.mockClear();
    const rendered = render(<StrictMode><SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" /></StrictMode>);
    rendered.rerender(<StrictMode><SalesSessionWorkspace sessionId="session-2" area="activity" queueHref="/sales?tab=sessions" /></StrictMode>);
    expect(await screen.findByRole("heading", { name: "Replacement session" })).not.toBeNull();
    resolveOld(new Response(JSON.stringify({ error: "Session expired" }), { status: 401 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Replacement session" })).not.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("session-2"))).toBe(true);
  });

  it("ignores an old Verify response after session replacement", async () => {
    let resolveVerify!: (value: Response) => void;
    const verify = new Promise<Response>((resolve) => { resolveVerify = resolve; });
    const next = { ...data, summary: { ...data.summary, id: "session-2", sessionName: "Replacement session" } };
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/verify")) return verify;
      if (url.includes("/participants?")) return new Response(JSON.stringify({ participants: [], total: 0, offset: 0, limit: 25, hasMore: false }), { status: 200 });
      return new Response(JSON.stringify(url.includes("session-2") ? next : data), { status: 200 });
    });
    const rendered = render(<StrictMode><SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" /></StrictMode>);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify now" }));
    expect(screen.getByRole("button", { name: "Verifying…" })).not.toBeNull();
    rendered.rerender(<StrictMode><SalesSessionWorkspace sessionId="session-2" area="participants" queueHref="/sales?tab=sessions" /></StrictMode>);
    await screen.findByRole("heading", { name: "Replacement session" });
    await screen.findByText("No Participants are registered for this Sales Session.");
    resolveVerify(new Response(JSON.stringify({ correlationId: "old-verify", experienceStatus: "inProgress", observedAt: "2026-07-24T09:01:00.000Z", freshness: "fresh", source: "cloudshare_v4_get_sales" }), { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/Verifying this Sales Session/)).toBeNull();
    expect(screen.queryByText(/old-verify/)).toBeNull();
    expect((screen.getByRole("button", { name: "Verify now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears automatic support correlation before retry and settles success cleanly", async () => {
    let posts = 0;
    let resolveFailureB!: (value: Response) => void;
    const failureB = new Promise<Response>((resolve) => { resolveFailureB = resolve; });
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
    const fresh = { ...data, summary: { ...data.summary, experience: { value: "inProgress", source: "cloudshare_v4_sales_list", freshness: "fresh", observedAt: "2026-07-24T09:01:00.000Z" } } };
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/workspace")) return new Response(JSON.stringify(posts >= 3 ? fresh : stale), { status: 200 });
      if (init?.method === "POST") { posts += 1; if (posts === 1) return new Response(JSON.stringify({ error: "Failure A", correlationId: "corr-A" }), { status: 503 }); if (posts === 2) return failureB; return new Response(JSON.stringify({ correlationId: "corr-C" }), { status: 200 }); }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Acme enablement" });
    await screen.findByText("Failure A");
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).toContain("corr-A");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    resolveFailureB(new Response(JSON.stringify({ error: "Failure B" }), { status: 503 }));
    await screen.findByText("Failure B");
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).not.toContain("corr-A");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("CloudShare status refreshed.");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("refresh?mode=automatic"))).toHaveLength(3);
  });

  it("presents retained ambiguity as incomplete beside a later definite failure", async () => {
    const responseBody = { ...data, activityGroups: [
      { workflowId: "ambiguous", summary: "Business outcome and evidence are incomplete.", outcome: "incomplete", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:00:00.000Z", lastAt: "2026-07-23T09:01:00.000Z", count: 2, correlationId: "corr-ambiguous", steps: [{ label: "OAuth token acquired.", outcome: "success", occurredAt: "2026-07-23T09:00:00.000Z" }, { label: "Business outcome unknown.", outcome: "incomplete", occurredAt: "2026-07-23T09:01:00.000Z" }], diagnosticRecords: [] },
      { workflowId: "definite", summary: "Sales Session provision failed.", outcome: "failure", actor: "Sales admin", subject: "This Sales Session", firstAt: "2026-07-23T09:02:00.000Z", lastAt: "2026-07-23T09:02:00.000Z", count: 1, correlationId: "corr-definite", steps: [{ label: "Sales Session provision failed.", outcome: "failure", occurredAt: "2026-07-23T09:02:00.000Z" }], diagnosticRecords: [] },
    ] };
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    expect(await screen.findByText("Business outcome and evidence are incomplete.")).not.toBeNull();
    expect(screen.queryByText("OAuth token acquired.")).toBeNull();
    expect(screen.queryByText("Business outcome unknown.")).toBeNull();
    expect(screen.getByText("Sales Session provision failed.")).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Open Sales support investigation" })).toHaveLength(2);
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toEqual(expect.arrayContaining(["2026-07-23T09:00:00.000Z", "2026-07-23T09:01:00.000Z", "2026-07-23T09:02:00.000Z"]));
    expect(document.body.textContent).not.toMatch(/loginUrl|Bearer|provider-id|requestJson|responseJson|subjectId=/i);
  });

  it("presents Details as labelled relationship and configuration groups", async () => {
    vi.spyOn(window, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
    render(<SalesSessionWorkspace sessionId="session-1" area="details" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("region", { name: "Sales relationship" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "Session configuration" })).not.toBeNull();
    expect(screen.getByText("Native invitations")).not.toBeNull();
  });
});
