/** @vitest-environment jsdom */
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SalesParticipantWorkspace } from "./sales-participant-workspace";
import { SalesParticipantExtension } from "./sales-participant-extension";
afterEach(cleanup);
it("defaults to all eligible Participants across pages and sends a narrowed deliberate selection", async () => {
  const request = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(_url.endsWith("/refresh") ? { outcome: "refreshed" } : init?.method === "POST" ? { commandId: "command1", outcome: "completed", finished: true, targets: [{ participantId: "p1", outcome: "confirmed", confirmedExpiry: "2026-09-21T10:00:00Z" }], sessionEnd: "2026-09-21T10:00", timeZone: "UTC" } : null)));
  render(<SalesParticipantExtension sessionId="s1" request={request} onRefreshed={async () => true} rows={[{ id: "p1", name: "Ada", participationStatus: "inProgress", environment: { value: "Ready" } }, { id: "p2", name: "Grace", participationStatus: "inProgress", environment: { value: "Suspended" } }] as never} />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/sales/enablement-sessions/s1/participants/refresh", expect.objectContaining({ method: "POST" })));
  await waitFor(() => expect((screen.getByRole("group", { name: "Extend Participant environments" }) as HTMLFieldSetElement).disabled).toBe(false));
  const user = userEvent.setup();
  expect((screen.getByRole("checkbox", { name: "Extend Ada" }) as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "Extend Grace" }));
  await user.click(screen.getByRole("button", { name: "Extend selected Participants" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(request.mock.calls.find(call => call[0].endsWith("/extend") && call[1]?.method === "POST")![1]!.body as string);
  expect(body.selection).toEqual({ mode: "all", excludedIds: ["p2"] });
  expect(await screen.findByText(/Extension completed/)).toBeTruthy();
});

const participant = { id: "p1", name: "Ada Lovelace", email: "ada@example.test", invitationStatus: "sent", participationStatus: "pending", participantRevision: "2026-07-24T08:00:00.000Z", environment: { dimension: "cloudshare_environment", value: "Ready", source: "cloudshare_v4_sales_participant_roster", observedAt: "2026-07-24T08:00:00.000Z" }, primaryAction: "generate_launch", actionAvailability: { invite: { available: true, reason: "available_to_attempt" }, resend: { available: true, reason: "available_to_attempt" }, generate_launch: { available: true, reason: "available_to_attempt" }, revoke_launch: { available: true, reason: "available_to_attempt" }, open_diagnostics: { available: false, reason: "unavailable_for_state" } } } as const;
const page = { participants: [participant], total: 1, offset: 0, limit: 25, hasMore: false };

it("refreshes eligibility on normal workspace entry, rereads a bounded page, and preserves Inspect/Close", async () => {
  let refreshed = false;
  let reads = 0;
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/refresh")) { refreshed = true; return Response.json({ outcome: "refreshed" }); }
    if (url.endsWith("/extend")) return Response.json(init?.method === "POST" ? { commandId: "cmd", selection: { mode: "all", excludedIds: [] }, outcome: "completed", finished: true, targets: [] } : null);
    expect(url).toMatch(/participants\?offset=0&limit=25$/);
    reads += 1;
    return Response.json({ ...page, participants: [{ ...participant, participationStatus: refreshed ? "inProgress" : "pending", environment: { ...participant.environment, value: refreshed ? "Ready" : "Not observed" } }] });
  });
  render(<SalesParticipantWorkspace sessionId="s1" active request={request} />);
  const checkbox = await screen.findByRole("checkbox", { name: "Extend Ada Lovelace" });
  await waitFor(() => expect((screen.getByRole("group", { name: "Extend Participant environments" }) as HTMLFieldSetElement).disabled).toBe(false));
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  expect(reads).toBe(2);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Inspect" }));
  await user.click(screen.getByRole("button", { name: "Close" }));
  const beforeExtension = reads;
  await user.click(screen.getByRole("button", { name: "Extend selected Participants" }));
  await screen.findByText("Extension completed.");
  await waitFor(() => expect(reads).toBeGreaterThan(beforeExtension));
  expect(request.mock.calls.filter(([url]) => url.endsWith("/refresh"))).toHaveLength(1);
});

it("ignores a delayed eligibility refresh from a departed Session", async () => {
  let finish!: (response: Response) => void;
  const rereadOld = vi.fn(async () => true);
  const rereadNew = vi.fn(async () => true);
  const request = vi.fn(async (url: string) => url.includes("/s1/") ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(url.endsWith("/refresh") ? { outcome: "refreshed" } : null));
  const view = render(<SalesParticipantExtension key="s1" sessionId="s1" request={request} rows={[]} onRefreshed={rereadOld} />);
  view.rerender(<SalesParticipantExtension key="s2" sessionId="s2" request={request} rows={[]} onRefreshed={rereadNew} />);
  await waitFor(() => expect(rereadNew).toHaveBeenCalledOnce());
  await act(async () => finish(Response.json({ outcome: "refreshed" })));
  expect(rereadOld).not.toHaveBeenCalled();
  expect(request.mock.calls.some(([url]) => url.includes("/s1/") && url.endsWith("/extend"))).toBe(false);
});
it("keeps extension disabled after a failed eligibility read and retries only the read", async () => {
  let attempts = 0;
  const reread = vi.fn(async () => true);
  const request = vi.fn(async (url: string) => url.endsWith("/refresh") ? Response.json({}, { status: ++attempts === 1 ? 503 : 200 }) : Response.json(null));
  render(<SalesParticipantExtension sessionId="s1" request={request} rows={[]} onRefreshed={reread} />);
  const retry = await screen.findByRole("button", { name: "Retry Participant read" });
  expect((screen.getByRole("group", { name: "Extend Participant environments" }) as HTMLFieldSetElement).disabled).toBe(true);
  await userEvent.setup().click(retry);
  await waitFor(() => expect((screen.getByRole("group", { name: "Extend Participant environments" }) as HTMLFieldSetElement).disabled).toBe(false));
  expect(reread).toHaveBeenCalledOnce();
  expect(request.mock.calls.filter(([url]) => url.endsWith("/refresh"))).toHaveLength(2);
});
