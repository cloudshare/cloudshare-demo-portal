/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SalesParticipantExtension } from "./sales-participant-extension";
afterEach(cleanup);
it("defaults to all eligible Participants across pages and sends a narrowed deliberate selection", async () => {
  const request = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { commandId: "command1", outcome: "completed", finished: true, targets: [{ participantId: "p1", outcome: "confirmed", confirmedExpiry: "2026-09-21T10:00:00Z" }], sessionEnd: "2026-09-21T10:00", timeZone: "UTC" } : null)));
  render(<SalesParticipantExtension sessionId="s1" request={request} rows={[{ id: "p1", name: "Ada", participationStatus: "inProgress", environment: { value: "Ready" } }, { id: "p2", name: "Grace", participationStatus: "inProgress", environment: { value: "Suspended" } }] as never} />);
  const user = userEvent.setup();
  expect((screen.getByRole("checkbox", { name: "Extend Ada" }) as HTMLInputElement).checked).toBe(true);
  await user.click(screen.getByRole("checkbox", { name: "Extend Grace" }));
  await user.click(screen.getByRole("button", { name: "Extend selected Participants" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "POST" })));
  const body = JSON.parse(request.mock.calls.find(call => call[1]?.method === "POST")![1]!.body as string);
  expect(body.selection).toEqual({ mode: "all", excludedIds: ["p2"] });
  expect(await screen.findByText(/Extension completed/)).toBeTruthy();
});
