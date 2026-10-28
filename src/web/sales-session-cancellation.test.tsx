// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SalesSessionCancellation } from "./sales-session-cancellation";
import { SalesSessionWorkspace } from "./sales-session-workspace";
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
it("rereads the Session header End after confirmed cancellation through the normal controls", async () => {
  let end = "2026-09-21T10:27";
  vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/cancel")) {
      if (init?.method !== "POST") return json(null);
      end = "2026-09-19T21:14";
      return json({ commandId: "cmd", correlationId: "cmd", status: "Cancelled", cancelledAt: "2026-09-19T21:14:05.375Z", accessConfirmed: true, targets: [], reconcile: false });
    }
    return json({ summary: { id: "s1", sessionName: "Cancellation QA", revision: 1, start: "2026-09-19T10:00", end, timeZone: "UTC", operation: { value: "correlated", source: "certalis_persistence" }, experience: { value: "inProgress", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-09-19T21:13:00.000Z" } }, participants: [], activity: [], details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Item", invitationMode: "No invitations" } });
  });
  render(<SalesSessionWorkspace sessionId="s1" area="details" queueHref="/sales?tab=sessions" />);
  await screen.findByText("2026-09-21T10:27");
  await waitFor(() => expect((screen.getByRole("button", { name: "Cancel Session" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Cancel Session" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(await screen.findByText("Experience end and label confirmed.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("2026-09-19T21:14")).not.toBeNull());
});
it("requires destructive-impact confirmation and shows retained history and per-participant outcome", async () => {
  const request = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method ? { commandId: "cmd", correlationId: "cmd", status: "Cancelled", outcome: "cancelled", cancelledAt: "2026-09-19T10:00:00.000Z", accessConfirmed: true, accessRetryable: false, targets: [{ participantId: "p1", outcome: "archived", retryable: false }], reconcile: false } : null));
  const onAdmitted = vi.fn();
  render(<SalesSessionCancellation sessionId="s1" request={request} onAdmitted={onAdmitted} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Cancel Session" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Cancel Session" }));
  expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(screen.getByRole("alertdialog").textContent).toContain("future Start will be deleted from CloudShare");
  expect(screen.getByRole("alertdialog").textContent).toContain("All portal history is retained");
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(await screen.findByRole("heading", { name: "Cancelled" })).toBeTruthy();
  expect(screen.getByText(/Environment archived/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open cancellation diagnostics" }).getAttribute("href")).toContain("correlationId=cmd");
  expect(onAdmitted).toHaveBeenCalled();
  expect(JSON.parse(request.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string)).toMatchObject({ confirmed: true });
});
it("confirms a separate future deletion step and shows retained portal history", async () => {
  const result = { commandId: "cmd", correlationId: "cmd", status: "Cancellation needs attention", cancelledAt: "2026-09-19T10:00:00.000Z", accessConfirmed: false, accessRetryable: false, futureDeletionAvailable: true, targets: [], reconcile: true };
  const request = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === "POST" ? { ...result, status: "Cancelled", experienceDeleted: true, futureDeletionAvailable: false, reconcile: false } : result));
  render(<SalesSessionCancellation sessionId="s1" request={request} onAdmitted={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel future Experience" }));
  expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(await screen.findByText("Future CloudShare Experience deleted. All portal history is retained.")).toBeTruthy();
  expect(JSON.parse(request.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body as string)).toMatchObject({ commandId: "cmd", confirmed: true, deleteFuture: true });
});
it("offers only read-only reconciliation when every provider write was already attempted", async () => {
  const result = { commandId: "cmd", correlationId: "cmd", status: "Cancellation needs attention", outcome: "needs_attention", cancelledAt: "2026-09-19T10:00:00.000Z", accessConfirmed: false, accessRetryable: false, targets: [{ participantId: "p1", outcome: "dispatched", retryable: false }], reconcile: true };
  const request = vi.fn(async () => json(result));
  render(<SalesSessionCancellation sessionId="s1" request={request} onAdmitted={() => {}} />);
  await screen.findByRole("heading", { name: "Cancellation needs attention" });
  expect(screen.queryByRole("button", { name: "Retry unattempted cancellation steps" })).toBeNull();
});

it("allows explicit resubmission of the same identity after a saved-state-null read", async () => {
  const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ error: "Admission deferred" }), { status: 409 }) : json(null));
  render(<SalesSessionCancellation sessionId="s1" request={request} onAdmitted={() => {}} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Cancel Session" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Cancel Session" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check saved cancellation state" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Cancel Session" }) as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Cancel Session" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  const posts = request.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[1]![1]!.body as string).commandId).toBe(JSON.parse(posts[0]![1]!.body as string).commandId);
});
