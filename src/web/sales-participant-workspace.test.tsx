/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    window.history.pushState({}, "", "/sales?participantQuery=ada");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(1));
  });
  it("opens and closes the inspector through the public keyboard seam", async () => {
    const user = userEvent.setup();
    render(<SalesParticipantWorkspace sessionId="s1" active request={async () => new Response(JSON.stringify(page))} />);
    await screen.findByRole("table", { name: "Participant roster" });
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByRole("complementary", { name: "Participant inspector" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Participant inspector" })).toBeNull();
  });
});
