/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateHome } from "./candidate-home";

let currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-ready");
const routerPush = vi.fn();
const routerReplace = vi.fn();
const routerRefresh = vi.fn();
const router = {
  push: routerPush,
  replace: routerReplace,
  refresh: routerRefresh,
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => currentSearchParams,
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("CandidateHome route-backed task flow", () => {
  const originalTimezone = process.env.TZ;
  const originalWindowFetch = window.fetch;

  beforeEach(() => {
    process.env.TZ = "Europe/London";
    currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-ready");
    routerPush.mockReset();
    routerReplace.mockReset();
    routerRefresh.mockReset();
  });

  afterEach(() => {
    process.env.TZ = originalTimezone;
    vi.unstubAllGlobals();
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: originalWindowFetch,
      writable: true,
    });
  });

  it("keeps unpublished attempt timing evidence and score review visible from attempt-scoped fallback data", async () => {
    const browserFetch = vi.fn((input: RequestInfo | URL) => {
      switch (String(input)) {
        case "/api/auth/session":
          return Promise.resolve(new Response(null, { status: 200 }));
        case "/api/candidate/exams":
          return Promise.resolve(
            json({
              exams: [],
              attempts: [
                {
                  id: "attempt-unpublished",
                  examId: "exam-unpublished",
                  examTitle: "Unpublished Windows Boxes",
                  timeLimitMinutes: 10,
                  openPeriodMinutes: 20,
                  storageLeaseMinutes: 1440,
                  scoreRetrievalEnabled: true,
                  scheduledFor: "2026-06-16T16:00:00.000Z",
                  status: "completed",
                },
              ],
            }),
          );
        default:
          throw new Error(`Unexpected fetch: ${String(input)}`);
      }
    });

    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: browserFetch,
      writable: true,
    });

    currentSearchParams = new URLSearchParams("task=history&attemptId=attempt-unpublished");

    render(
      <CandidateHome
        email="candidate@helioscx.demo"
        initialRoute={{ task: "history", attemptId: "attempt-unpublished", examId: null }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Completed and expired attempts" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View score" })).toBeTruthy();
    expect(screen.getByText("10 minute runtime limit")).toBeTruthy();
    expect(screen.getByText("20 minute open window")).toBeTruthy();
    expect(screen.getByText("1440 minute environment retention")).toBeTruthy();
  });

  it("moves focus to the active task heading and announces route-backed task changes", async () => {
    const user = userEvent.setup();
    const browserFetch = vi.fn((input: RequestInfo | URL) => {
      switch (String(input)) {
        case "/api/auth/session":
          return Promise.resolve(new Response(null, { status: 200 }));
        case "/api/candidate/exams":
          return Promise.resolve(
            json({
              exams: [
                {
                  id: "exam-1",
                  title: "Helios Fundamentals",
                  description: "",
                  timeLimitMinutes: 90,
                  storageLeaseMinutes: 2880,
                  openPeriodMinutes: 120,
                  scoreRetrievalEnabled: true,
                  individualSchedulingEnabled: true,
                  availableCohortSessions: [],
                },
              ],
              attempts: [
                {
                  id: "attempt-ready",
                  examId: "exam-1",
                  scheduledFor: "2026-10-23T16:00:00.000Z",
                  status: "ready",
                },
              ],
            }),
          );
        default:
          throw new Error(`Unexpected fetch: ${String(input)}`);
      }
    });

    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: browserFetch,
      writable: true,
    });

    const rendered = render(
      <CandidateHome
        email="candidate@helioscx.demo"
        initialRoute={{ task: "current", attemptId: "attempt-ready", examId: null }}
      />,
    );

    const currentHeading = await screen.findByRole("heading", { name: "Your current ExamAttempt" });
    expect(document.activeElement).not.toBe(currentHeading);

    await user.click(screen.getByRole("button", { name: /^Schedule exam/ }));
    expect(routerPush).toHaveBeenCalledWith("/candidate?task=schedule");

    currentSearchParams = new URLSearchParams("task=schedule");
    rendered.rerender(
      <CandidateHome
        email="candidate@helioscx.demo"
        initialRoute={{ task: "current", attemptId: "attempt-ready", examId: null }}
      />,
    );

    const scheduleHeading = await screen.findByRole("heading", { name: "Choose an exam" });
    await waitFor(() => expect(document.activeElement).toBe(scheduleHeading));
    expect(screen.getByRole("status", { name: "Candidate route status" }).textContent).toContain(
      "Now showing Schedule exam.",
    );
  });

  it("explains a scheduled current attempt and clears routed focus styling on blur", async () => {
    const browserFetch = vi.fn((input: RequestInfo | URL) => input === "/api/candidate/exams"
      ? Promise.resolve(json({ exams: [{ id: "exam-1", title: "Helios Fundamentals", description: "", timeLimitMinutes: 90, storageLeaseMinutes: 2880, openPeriodMinutes: 120, scoreRetrievalEnabled: true, individualSchedulingEnabled: true, availableCohortSessions: [] }], attempts: [{ id: "attempt-scheduled", examId: "exam-1", examTitle: "Helios Fundamentals", scheduledFor: "2026-10-23T16:00:00.000Z", status: "scheduled" }] }))
      : Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-scheduled");
    const routed = render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: "attempt-scheduled", examId: null }} />);
    expect(await screen.findByText(/scheduled.*enable entry.*access window/i)).toBeTruthy();
    const user = userEvent.setup();
    const scheduleButton = await screen.findByRole("button", { name: /^Schedule exam/ });
    await user.click(scheduleButton);
    expect(routerPush).toHaveBeenCalledWith("/candidate?task=schedule");
    currentSearchParams = new URLSearchParams("task=schedule");
    // The existing render represents the route transition after the browser navigation.
    await act(async () => routed.rerender(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: "attempt-scheduled", examId: null }} />));
    const heading = await screen.findByRole("heading", { name: "Choose an exam" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await act(async () => heading.blur());
    expect(heading.style.boxShadow).toBe("");
  });

  it("shows background refresh progress without stealing a focused task control", async () => {
    let releaseRefresh!: (response: Response) => void;
    let calls = 0;
    const browserFetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input) !== "/api/candidate/exams") return Promise.resolve(new Response(null, { status: 200 }));
      calls += 1;
      if (calls === 1) return Promise.resolve(json({ exams: [], attempts: [] }));
      return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    });
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    const rendered = render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: null, examId: null }} />);
    const control = await screen.findByRole("button", { name: /^Schedule exam/ }).catch(() => screen.getByRole("button", { name: /Current ExamAttempt/ }));
    control.focus();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("Refreshing candidate delivery status…")).toBeTruthy();
    expect(document.activeElement).toBe(control);
    await act(async () => releaseRefresh(json({ exams: [], attempts: [] })));
    await waitFor(() => expect(screen.queryByText("Refreshing candidate delivery status…")).toBeNull());
    expect(document.activeElement).toBe(control);
    rendered.unmount();
  });
});
