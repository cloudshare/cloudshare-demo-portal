/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionWorkspace } from "./sales-session-workspace";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const data = { summary: { id: "session-1", sessionName: "Acme enablement", revision: 3, start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "Europe/London", operation: { value: "correlated", source: "certalis_persistence" }, experience: { value: "notStarted", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-07-24T08:59:00.000Z" } }, participants: [{ id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", environment: { value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" } }], activity: [{ occurredAt: "2026-07-23T09:00:00.000Z", kind: "session_provision", summary: "Sales Session provision completed.", outcome: "success", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" }, correlationId: "corr-1" }], details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement item", invitationMode: "Sales Pros and participants" } };

describe("Sales Session workspace", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("refreshes an estimated workspace, exposes failure support, and retries with a local reread", async () => {
    const user = userEvent.setup();
    let releaseFailure!: () => void;
    const pending = new Promise<void>((resolve) => { releaseFailure = resolve; });
    let automaticPosts = 0;
    const stale = { ...data, summary: { ...data.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "estimated" } } };
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
    expect((screen.getByRole("button", { name: "Verify now" }) as HTMLButtonElement).disabled).toBe(true);
    releaseFailure();
    await screen.findByText("CloudShare unavailable");
    expect(screen.getByRole("link", { name: "Open Sales support" }).getAttribute("href")).toContain("refresh-fail");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("CloudShare status refreshed.");
    expect(automaticPosts).toBe(2);
    expect((screen.getByRole("button", { name: "Verify now" }) as HTMLButtonElement).disabled).toBe(false);
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
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions&queue=history&offset=25" />);

    expect(await screen.findByRole("heading", { name: "Acme enablement" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Participants" })).not.toBeNull();
    expect(document.body.textContent).toContain("2026-07-24T09:00:00.000Z · Europe/London");
    expect(document.body.textContent).toContain("Observed from CloudShare participant roster");
    expect(document.body.textContent).not.toContain("cloudshare_v4_sales_participant_roster");
    expect(screen.getByRole("link", { name: "Activity" }).getAttribute("href")).toContain("area=activity");
    expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toContain("area=details");
    expect(screen.getByRole("link", { name: "Back to Sessions" }).getAttribute("href")).toBe("/sales?tab=sessions&queue=history&offset=25");
    expect(screen.getByRole("cell", { name: /Ready/ })).not.toBeNull();
  });

  it("invokes the browser fetch interface with its required Window receiver", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(function (this: Window) {
      if (this !== window) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
    });

    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("heading", { name: "Acme enablement" })).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
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
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area={area} queueHref="/sales?tab=sessions" />);
    const firstHeading = await screen.findByRole("heading", { name: area[0].toUpperCase() + area.slice(1) });
    await waitFor(() => expect(document.activeElement).toBe(firstHeading));
    expect(firstHeading.getAttribute("tabindex")).toBe("-1");
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    const heading = await screen.findByRole("heading", { name: "Activity" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("does not steal focus again when the loaded workspace rerenders", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
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
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(needsAttention), { status: 200 }));

    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByText("Participant correlation requires support.")).not.toBeNull();
  });

  it("presents Participants as a labelled read-only roster preview", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("table", { name: "Participant roster preview" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Participant" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Environment source" })).not.toBeNull();
    expect(screen.getByText(/Detailed participant management follows in a later workspace/)).not.toBeNull();
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
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(attentionData), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByText("Needs attention")).not.toBeNull();
    expect(screen.getByText("Multiple matching Participant Environments require support review.")).not.toBeNull();
    expect(screen.getByText(/Attention source: Certalis Environment correlation check/)).not.toBeNull();
    expect(screen.getByText("CloudShare Environment state has not been observed")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/Bearer|provider response/);
  });

  it("groups equivalent safe Activity while retaining its time range, count, and diagnostic link", async () => {
    const repeatedActivity = {
      ...data,
      activity: [
        data.activity[0],
        { ...data.activity[0], occurredAt: "2026-07-23T09:02:00.000Z" },
        { ...data.activity[0], occurredAt: "2026-07-23T09:04:00.000Z", correlationId: "corr-2" },
      ],
    };
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(repeatedActivity), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("list", { name: "Sales Session activity timeline" })).not.toBeNull();
    expect(screen.getByText("3 equivalent events")).not.toBeNull();
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toContain("2026-07-23T09:00:00.000Z");
    expect(screen.getAllByRole("time").map((time) => time.getAttribute("dateTime"))).toContain("2026-07-23T09:04:00.000Z");
    expect(screen.getByText("2 diagnostic records")).not.toBeNull();
    const correlationDisclosure = document.querySelector("details");
    expect(correlationDisclosure?.open).toBe(false);
    expect(correlationDisclosure?.querySelectorAll("a")).toHaveLength(2);
    expect(correlationDisclosure?.textContent).toContain("Diagnostic records connect this Activity to protected Support evidence");
    expect(correlationDisclosure?.querySelector('[href*="corr-1"]')?.textContent).toBe("Open diagnostic record from 2026-07-23T09:00:00.000Z");
    expect(correlationDisclosure?.querySelector('[href*="corr-2"]')?.textContent).toBe("Open diagnostic record from 2026-07-23T09:04:00.000Z");
    expect(correlationDisclosure?.textContent).not.toContain("corr-1");
    expect(correlationDisclosure?.textContent).not.toContain("corr-2");
    expect(screen.getByText("Actor: Sales admin")).not.toBeNull();
    expect(screen.getByText("Subject: This Sales Session")).not.toBeNull();
    expect(screen.getByText(/Activity shows ordinary operational metadata only/)).not.toBeNull();
  });

  it("presents Details as labelled relationship and configuration groups", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="details" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("region", { name: "Sales relationship" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "Session configuration" })).not.toBeNull();
    expect(screen.getByText("Native invitations")).not.toBeNull();
  });
});
