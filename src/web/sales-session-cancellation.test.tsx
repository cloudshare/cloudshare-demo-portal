// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SalesSessionCancellation } from "./sales-session-cancellation";
afterEach(cleanup);
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
it("requires destructive-impact confirmation and shows retained history and per-participant outcome", async () => {
  const request = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method ? { commandId: "cmd", correlationId: "cmd", status: "Cancelled", outcome: "cancelled", cancelledAt: "2026-09-19T10:00:00.000Z", accessConfirmed: true, accessRetryable: false, targets: [{ participantId: "p1", outcome: "archived", retryable: false }], reconcile: false } : null));
  const onAdmitted = vi.fn();
  render(<SalesSessionCancellation sessionId="s1" request={request} onAdmitted={onAdmitted} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Cancel Session" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Cancel Session" }));
  expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(screen.getByRole("alertdialog").textContent).toContain("will not be deleted");
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(await screen.findByRole("heading", { name: "Cancelled" })).toBeTruthy();
  expect(screen.getByText(/Environment archived/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open cancellation diagnostics" }).getAttribute("href")).toContain("correlationId=cmd");
  expect(onAdmitted).toHaveBeenCalled();
  expect(JSON.parse(request.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string)).toMatchObject({ confirmed: true });
});
it("offers only read-only reconciliation when every provider write was already attempted", async () => {
  const result = { commandId: "cmd", correlationId: "cmd", status: "Cancellation needs attention", outcome: "needs_attention", cancelledAt: "2026-09-19T10:00:00.000Z", accessConfirmed: false, accessRetryable: false, targets: [{ participantId: "p1", outcome: "dispatched", retryable: false }], reconcile: true };
  const request = vi.fn(async () => json(result));
  render(<SalesSessionCancellation sessionId="s1" request={request} onAdmitted={() => {}} />);
  await screen.findByRole("heading", { name: "Cancellation needs attention" });
  expect(screen.queryByRole("button", { name: "Retry unattempted cancellation steps" })).toBeNull();
});
