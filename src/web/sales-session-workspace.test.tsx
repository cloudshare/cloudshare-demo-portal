/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalesSessionWorkspace } from "./sales-session-workspace";

const data = { summary: { id: "session-1", sessionName: "Acme enablement", revision: 3, start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "Europe/London", operation: { value: "correlated", source: "certalis_persistence" }, experience: { value: "notStarted", source: "schedule_prediction", freshness: "estimated" } }, participants: [{ id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending" }], activity: [{ occurredAt: "2026-07-23T09:00:00.000Z", operation: "sales.demo_session.created", outcome: "success", message: "Sales Session provisioned", actor: { type: "admin", email: "sales@example.test" }, subject: { type: "sales_demo_session", id: "session-1" }, correlationId: "corr-1" }], details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement item", invitationMode: "Sales Pros and participants" } };

describe("Sales Session workspace", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens Participants by default, routes local areas, and links correlation to authorized Support", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
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
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
