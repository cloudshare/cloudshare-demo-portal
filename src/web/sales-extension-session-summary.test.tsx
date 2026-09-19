/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SalesSessionWorkspace } from "./sales-session-workspace";
const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const data = { summary: { id: "session-1", sessionName: "Acme enablement", revision: 3, start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "Europe/London", operation: { value: "correlated", source: "certalis_persistence" }, experience: { value: "notStarted", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-07-24T08:59:00.000Z" } }, participants: [{ id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" }, primaryAction: "resend", actionAvailability: { invite: { available: false, reason: "invitation_already_sent" }, resend: { available: true, reason: "available_to_attempt" }, generate_launch: { available: true, reason: "available_to_attempt" }, revoke_launch: { available: false, reason: "no_active_launch" }, open_diagnostics: { available: false, reason: "unavailable_for_state" } } }], total: 1, offset: 0, limit: 25, hasMore: false, activity: [{ occurredAt: "2026-07-23T09:00:00.000Z", kind: "session_provision", summary: "Sales Session provision completed.", outcome: "success", actor: { type: "admin" }, subject: { type: "sales_demo_session", id: "session-1" }, correlationId: "corr-1" }], details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement item", invitationMode: "Sales Pros and participants" } };

const newEnd = "2026-07-25T12:00:00.000Z";
it.each(["completed", "partial"])("rereads the authenticated Session header after %s confirmed access", async outcome => {
  let extended = false;
  const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/workspace")) return Response.json({ ...data, summary: { ...data.summary, end: extended ? newEnd : data.summary.end } });
    if (url.endsWith("/refresh")) return Response.json({ outcome: "refreshed" });
    if (url.endsWith("/extend")) { if (init?.method === "POST") { extended = true; return Response.json({ commandId: "cmd", outcome, accessConfirmed: true, finished: outcome === "completed", targets: [] }); } return Response.json(null); }
    return Response.json(data);
  });
  render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales" />);
  await waitFor(() => expect((screen.getByRole("group", { name: "Extend Participant environments" }) as HTMLFieldSetElement).disabled).toBe(false));
  await userEvent.setup().click(screen.getByRole("button", { name: "Extend selected Participants" }));
  expect(await screen.findByText(newEnd)).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/workspace"))).toHaveLength(2);
});
it("ignores an extension summary reread that returns after navigation to another Session", async () => {
  let extended = false;
  let finish!: (response: Response) => void;
  const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/session-2/") && url.endsWith("/workspace")) return Response.json({ ...data, summary: { ...data.summary, id: "session-2", sessionName: "Other Session" } });
    if (url.endsWith("/workspace")) return extended ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(data);
    if (url.endsWith("/refresh")) return Response.json({ outcome: "refreshed" });
    if (url.endsWith("/extend")) { if (init?.method === "POST") { extended = true; return Response.json({ commandId: "cmd", outcome: "completed", accessConfirmed: true, finished: true, targets: [] }); } return Response.json(null); }
    return Response.json(data);
  });
  const view = render(<SalesSessionWorkspace sessionId="session-1" area="participants" queueHref="/sales" />);
  await waitFor(() => expect((screen.getByRole("group", { name: "Extend Participant environments" }) as HTMLFieldSetElement).disabled).toBe(false));
  await userEvent.setup().click(screen.getByRole("button", { name: "Extend selected Participants" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/workspace"))).toHaveLength(2));
  view.rerender(<SalesSessionWorkspace sessionId="session-2" area="participants" queueHref="/sales" />);
  await screen.findByRole("heading", { name: "Other Session" });
  await act(async () => finish(Response.json({ ...data, summary: { ...data.summary, end: newEnd } })));
  expect(screen.queryByText(newEnd)).toBeNull();
  expect(screen.getByRole("heading", { name: "Other Session" })).toBeTruthy();
});
