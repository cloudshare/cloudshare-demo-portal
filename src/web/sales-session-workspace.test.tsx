/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionWorkspace } from "./sales-session-workspace";

const data = { summary: { id: "session-1", sessionName: "Acme enablement", revision: 3, start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "Europe/London", operation: { value: "correlated", source: "certalis_persistence" }, experience: { value: "notStarted", source: "schedule_prediction", freshness: "estimated" } }, participants: [{ id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", environment: { value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" } }], activity: [{ occurredAt: "2026-07-23T09:00:00.000Z", summary: "Sales Session provision completed.", outcome: "success", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" }, correlationId: "corr-1" }], details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement item", invitationMode: "Sales Pros and participants" } };

describe("Sales Session workspace", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

  it.each(["participants", "activity", "details"] as const)("moves focus to the %s heading after a fresh route load", async (area) => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area={area} queueHref="/sales?tab=sessions" />);
    const firstHeading = await screen.findByRole("heading", { name: area[0].toUpperCase() + area.slice(1) });
    await waitFor(() => expect(document.activeElement).toBe(firstHeading));
    rendered.rerender(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);
    const heading = await screen.findByRole("heading", { name: "Activity" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("does not steal focus again when the loaded workspace rerenders", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    const rendered = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales?tab=sessions" />);
    await screen.findByRole("heading", { name: "Participants" });
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

  it("groups equivalent safe Activity while retaining its time range, count, and diagnostic link", async () => {
    const repeatedActivity = {
      ...data,
      activity: [
        data.activity[0],
        { ...data.activity[0], occurredAt: "2026-07-23T09:02:00.000Z" },
        { ...data.activity[0], occurredAt: "2026-07-23T09:04:00.000Z" },
      ],
    };
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(repeatedActivity), { status: 200 }));
    render(<SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" />);

    expect(await screen.findByRole("list", { name: "Sales Session activity timeline" })).not.toBeNull();
    expect(screen.getByText("3 equivalent events")).not.toBeNull();
    expect(screen.getByText("2026-07-23T09:00:00.000Z to 2026-07-23T09:04:00.000Z")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open Support Diagnostics" })).not.toBeNull();
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
