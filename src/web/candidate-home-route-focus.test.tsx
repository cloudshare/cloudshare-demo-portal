/** @vitest-environment jsdom */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateHome } from "./candidate-home";
import { COLD_START_WARNING_MESSAGE } from "./candidate-home-state";

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
    window.history.replaceState(null, "", "/candidate?task=current&attemptId=attempt-ready");
    currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-ready");
    routerPush.mockReset();
    routerReplace.mockReset();
    routerRefresh.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTimezone;
    vi.unstubAllGlobals();
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: originalWindowFetch,
      writable: true,
    });
  });

  it("keeps unpublished attempt timing evidence and score review visible from attempt-scoped fallback data", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole("button", { name: "View score for Unpublished Windows Boxes, attempt attempt-unpublished" })).toBeTruthy();
    expect(screen.getByText("10 minute runtime limit")).toBeTruthy();
    expect(screen.getByText("20 minute open window")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Attempt details for Unpublished Windows Boxes, attempt attempt-unpublished" }));
    expect(screen.getByText("1440 minute environment retention")).toBeTruthy();
  });

  it("keeps focus on the task control and announces route-backed task changes", async () => {
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

    const currentHeading = await screen.findByRole("heading", { name: "Your current Exam Attempt" });
    expect(document.activeElement).not.toBe(currentHeading);

    const scheduleTaskButton = within(screen.getByRole("region", { name: "Candidate delivery tasks" }))
      .getByRole("button", { name: /^Schedule exam/ });
    await user.click(scheduleTaskButton);
    expect(window.location.href).toContain("/candidate?task=schedule&examId=exam-1");
    expect(routerPush).not.toHaveBeenCalled();

    currentSearchParams = new URLSearchParams("task=schedule");
    rendered.rerender(
      <CandidateHome
        email="candidate@helioscx.demo"
        initialRoute={{ task: "current", attemptId: "attempt-ready", examId: null }}
      />,
    );

    const scheduleHeading = await screen.findByRole("heading", { name: "Choose an exam" });
    expect(document.activeElement).toBe(scheduleTaskButton);
    expect(scheduleHeading.getAttribute("tabindex")).toBeNull();
    expect(scheduleHeading.style.outline).toBe("");
    expect(screen.getByRole("status", { name: "Candidate route status" }).textContent).toContain(
      "Now showing Schedule exam.",
    );
  });

  it("explains a scheduled current attempt without making the destination heading focusable", async () => {
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
    expect(window.location.href).toContain("/candidate?task=schedule&examId=exam-1");
    expect(routerPush).not.toHaveBeenCalled();
    currentSearchParams = new URLSearchParams("task=schedule");
    // The existing render represents the route transition after the browser navigation.
    await act(async () => routed.rerender(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: "attempt-scheduled", examId: null }} />));
    const heading = await screen.findByRole("heading", { name: "Choose an exam" });
    expect(document.activeElement).toBe(scheduleButton);
    expect(heading.getAttribute("tabindex")).toBeNull();
    expect(heading.style.outline).toBe("");
    expect(heading.style.outlineOffset).toBe("");
  });

  it("shows background refresh progress without stealing a focused task control", async () => {
    vi.useFakeTimers();
    let releaseRefresh!: (response: Response) => void;
    let calls = 0;
    const browserFetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input) !== "/api/candidate/exams") return Promise.resolve(new Response(null, { status: 200 }));
      calls += 1;
      if (calls === 1) return Promise.resolve(json({ exams: [{ id: "exam-1", title: "Foundations", description: "", timeLimitMinutes: 60, openPeriodMinutes: 60, storageLeaseMinutes: 60, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] }], attempts: [{ id: "attempt-1", examId: "exam-1", examTitle: "Foundations", scheduledFor: "2026-10-23T16:00:00.000Z", status: "ready" }] }));
      return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    });
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    const rendered = render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: null, examId: null }} />);
    await act(async () => { await Promise.resolve(); });
    const control = screen.getByRole("button", { name: /Current Exam Attempt/ });
    const taskShell = screen.getByRole("region", { name: "Candidate delivery tasks" });
    const accessibleRefreshStatus = screen.getByRole("status", { name: "Candidate delivery refresh status" });
    const idleRefreshSlot = rendered.container.querySelector<HTMLElement>("[data-candidate-refresh-visual='true']");
    expect(accessibleRefreshStatus.textContent).toBe("");
    expect(accessibleRefreshStatus.style.position).toBe("absolute");
    expect(idleRefreshSlot).toBeTruthy();
    expect(idleRefreshSlot?.getAttribute("aria-hidden")).toBe("true");
    expect(idleRefreshSlot?.style.height).toBe("2.75rem");
    expect(idleRefreshSlot?.style.visibility).toBe("hidden");
    control.focus();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const refreshStatus = screen.getByRole("status", { name: "Candidate delivery refresh status" });
    expect(refreshStatus.textContent).toBe("Refreshing candidate delivery status…");
    expect(refreshStatus).toBe(accessibleRefreshStatus);
    expect(idleRefreshSlot?.textContent).toBe("Refreshing candidate delivery status…");
    expect(idleRefreshSlot?.style.visibility).toBe("visible");
    expect(idleRefreshSlot?.style.height).toBe("2.75rem");
    expect(idleRefreshSlot?.style.overflow).toBe("hidden");
    expect(screen.getByRole("region", { name: "Candidate delivery tasks" })).toBe(taskShell);
    expect(document.activeElement).toBe(control);
    await act(async () => releaseRefresh(json({ exams: [], attempts: [] })));
    expect(screen.queryByText("Refreshing candidate delivery status…")).toBeNull();
    expect(screen.getByRole("status", { name: "Candidate delivery refresh status" })).toBe(refreshStatus);
    expect(refreshStatus.textContent).toBe("");
    expect(rendered.container.querySelector("[data-candidate-refresh-visual='true']")).toBe(idleRefreshSlot);
    expect(idleRefreshSlot?.style.visibility).toBe("hidden");
    expect(idleRefreshSlot?.style.height).toBe("2.75rem");
    expect(screen.getByRole("region", { name: "Candidate delivery tasks" })).toBe(taskShell);
    expect(document.activeElement).toBe(control);
    expect(screen.getByRole("status", { name: "Candidate route status" }).textContent).toBe("Now showing Attempt history.");
    rendered.unmount();
  });

  it("renders every current Exam Attempt as a complete card with its own action target", async () => {
    const user = userEvent.setup();
    const browserFetch = vi.fn((input: RequestInfo | URL) => String(input) === "/api/candidate/exams"
      ? Promise.resolve(json({
        exams: [
          { id: "exam-alpha", title: "Alpha Lab", description: "", timeLimitMinutes: 60, openPeriodMinutes: 90, storageLeaseMinutes: 1440, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
          { id: "exam-bravo", title: "Bravo Lab with a deliberately wrapping title", description: "", timeLimitMinutes: 45, openPeriodMinutes: 60, storageLeaseMinutes: 720, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
        ],
        attempts: [
          { id: "attempt-alpha", examId: "exam-alpha", examTitle: "Alpha Lab", scheduledFor: "2026-10-23T16:00:00.000Z", status: "suspended" },
          { id: "attempt-bravo", examId: "exam-bravo", examTitle: "Bravo Lab with a deliberately wrapping title", scheduledFor: "2026-10-23T17:00:00.000Z", status: "in_progress" },
        ],
      }))
      : Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-alpha");

    render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: "attempt-alpha", examId: null }} />);

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    const bravoFrontFace = cards[0]!.querySelector<HTMLElement>("[data-attempt-card-face='front']")!;
    const alphaFrontFace = cards[1]!.querySelector<HTMLElement>("[data-attempt-card-face='front']")!;
    const bravoBackFace = cards[0]!.querySelector<HTMLElement>("[data-attempt-card-face='back']")!;
    expect(cards[0]!.getAttribute("aria-labelledby")).toBeTruthy();
    const bravoHeading = within(cards[0]!).getByRole("heading", { name: "Bravo Lab with a deliberately wrapping title" });
    expect(within(bravoFrontFace).queryByText("Attempt ID: attempt-bravo")).toBeNull();
    expect(within(cards[0]!).getByText("In progress")).toBeTruthy();
    expect(within(cards[0]!).getByText("45 minute runtime limit")).toBeTruthy();
    expect(within(cards[0]!).getByText("60 minute open window")).toBeTruthy();
    expect(cards[1]!.getAttribute("aria-labelledby")).toBeTruthy();
    expect(within(cards[1]!).getByRole("heading", { name: "Alpha Lab" })).toBeTruthy();
    expect(cards[0]!.getAttribute("aria-current")).toBeNull();
    expect(cards[1]!.getAttribute("aria-current")).toBe("true");
    expect(within(cards[1]!).getByText("Opened attempt")).toBeTruthy();
    expect(screen.getAllByText("Opened attempt")).toHaveLength(1);
    expect(document.activeElement).not.toBe(within(cards[1]!).getByRole("heading", { name: "Alpha Lab" }));
    expect(within(alphaFrontFace).queryByText("Attempt ID: attempt-alpha")).toBeNull();
    expect(within(cards[1]!).getByText("Suspended")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Alpha Lab Suspended/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bravo Lab In progress/ })).toBeNull();

    const bravoDetails = within(cards[0]!).getByRole("button", { name: "Attempt details for Bravo Lab with a deliberately wrapping title, attempt attempt-bravo" });
    const bravoLifecycle = within(cards[0]!).getByRole("button", { name: "Return to exam for Bravo Lab with a deliberately wrapping title, attempt attempt-bravo" });
    const alphaDetails = within(cards[1]!).getByRole("button", { name: "Attempt details for Alpha Lab, attempt attempt-alpha" });
    const cardGrid = cards[0]!.parentElement as HTMLElement;
    const bravoFront = bravoFrontFace;
    const alphaFront = alphaFrontFace;
    expect(cardGrid.style.alignItems).toBe("start");
    expect(cards[0]!.style.height).toBe("34rem");
    expect(cards[1]!.style.height).toBe("34rem");
    expect(bravoHeading.style.webkitLineClamp).toBe("");
    expect(bravoFront.querySelector<HTMLElement>("[data-attempt-slot='title']")?.style.overflowY).toBe("auto");
    expect(bravoFront.querySelector<HTMLElement>("[data-attempt-slot='metadata']")?.style.gridTemplateColumns).toBe("minmax(0, 1fr) minmax(0, 1fr)");
    bravoLifecycle.focus();
    await user.tab();
    expect(document.activeElement).toBe(bravoDetails);
    await user.click(bravoDetails);
    const bravoBack = within(cards[0]!).getByRole("button", { name: "Back to attempt for Bravo Lab with a deliberately wrapping title, attempt attempt-bravo" });
    await waitFor(() => expect(document.activeElement).toBe(bravoBack));
    expect(bravoDetails.tabIndex).toBe(-1);
    expect(bravoLifecycle.tabIndex).toBe(-1);
    expect(bravoBack.tabIndex).toBe(0);
    await user.tab();
    expect(document.activeElement).not.toBe(bravoDetails);
    expect(document.activeElement).not.toBe(bravoLifecycle);
    expect(within(cards[0]!).getByText("Attempt ID: attempt-bravo")).toBeTruthy();
    expect(within(cards[0]!).getByText("720 minute environment retention")).toBeTruthy();
    expect(within(alphaFrontFace).queryByText("Attempt ID: attempt-alpha")).toBeNull();
    expect(within(cards[1]!).getByRole("button", { name: "Attempt details for Alpha Lab, attempt attempt-alpha" })).toBe(alphaDetails);
    expect(cards[0]!.querySelector("[data-attempt-card-face='front']")).toBe(bravoFront);
    expect(cards[1]!.querySelector("[data-attempt-card-face='front']")).toBe(alphaFront);
    expect(bravoFront.getAttribute("aria-hidden")).toBe("true");
    expect(bravoFront.style.pointerEvents).toBe("none");
    expect(bravoBackFace.getAttribute("aria-hidden")).toBe("false");
    expect(within(cards[0]!).queryByRole("button", { name: "Return to exam for Bravo Lab with a deliberately wrapping title, attempt attempt-bravo" })).toBeNull();
    expect(screen.getAllByRole("article")).toEqual(cards);

    await user.click(within(cards[1]!).getByRole("button", { name: "Resume exam for Alpha Lab, attempt attempt-alpha" }));
    expect(routerPush).toHaveBeenLastCalledWith("/candidate/lab?examAttemptId=attempt-alpha&attemptStatus=suspended");
    await user.click(bravoBack);
    await waitFor(() => expect(document.activeElement).toBe(bravoDetails));
    expect(within(cards[0]!).queryByRole("region", { name: "Attempt details for Bravo Lab with a deliberately wrapping title, attempt attempt-bravo" })).toBeNull();
    await user.click(within(cards[0]!).getByRole("button", { name: "Return to exam for Bravo Lab with a deliberately wrapping title, attempt attempt-bravo" }));
    expect(routerPush).toHaveBeenLastCalledWith("/candidate/lab?examAttemptId=attempt-bravo&attemptStatus=in_progress");
  });

  it("renders every history Exam Attempt as a stable complete card without an inner selector", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    renderToString(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "history", attemptId: "attempt-alpha", examId: null }} />);
    expect(window.matchMedia).not.toHaveBeenCalled();
    const browserFetch = vi.fn((input: RequestInfo | URL) => String(input) === "/api/candidate/exams"
      ? Promise.resolve(json({
        exams: [
          { id: "exam-alpha", title: "Alpha Lab", description: "", timeLimitMinutes: 60, openPeriodMinutes: 90, storageLeaseMinutes: 1440, scoreRetrievalEnabled: true, individualSchedulingEnabled: true, availableCohortSessions: [] },
          { id: "exam-bravo", title: "Bravo Lab", description: "", timeLimitMinutes: 45, openPeriodMinutes: 60, storageLeaseMinutes: 720, scoreRetrievalEnabled: true, individualSchedulingEnabled: true, availableCohortSessions: [] },
          { id: "exam-charlie", title: "Charlie Lab", description: "", timeLimitMinutes: 30, openPeriodMinutes: 45, storageLeaseMinutes: 360, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
        ],
        attempts: [
          { id: "attempt-alpha", examId: "exam-alpha", examTitle: "Alpha Lab", scheduledFor: "2026-10-23T16:00:00.000Z", status: "expired" },
          { id: "attempt-bravo", examId: "exam-bravo", examTitle: "Bravo Lab", scheduledFor: "2026-10-23T17:00:00.000Z", status: "completed" },
          { id: "attempt-charlie", examId: "exam-charlie", examTitle: "Charlie Lab", scheduledFor: "2026-10-23T15:00:00.000Z", status: "completed" },
        ],
      }))
      : Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    currentSearchParams = new URLSearchParams("task=history&attemptId=attempt-alpha");

    render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "history", attemptId: "attempt-alpha", examId: null }} />);

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.querySelector<HTMLElement>("[data-attempt-flip-inner='true']")?.style.transition === "none")).toBe(true);
    const bravoFrontFace = cards[0]!.querySelector<HTMLElement>("[data-attempt-card-face='front']")!;
    const alphaFrontFace = cards[1]!.querySelector<HTMLElement>("[data-attempt-card-face='front']")!;
    expect(within(cards[0]!).getByRole("heading", { name: "Bravo Lab" })).toBeTruthy();
    expect(within(cards[0]!).getByText("Completed")).toBeTruthy();
    expect(within(bravoFrontFace).queryByText("Attempt ID: attempt-bravo")).toBeNull();
    expect(within(cards[0]!).getByText("45 minute runtime limit")).toBeTruthy();
    expect(within(cards[0]!).getByText("60 minute open window")).toBeTruthy();
    expect(within(bravoFrontFace).queryByText("720 minute environment retention")).toBeNull();
    expect(within(cards[0]!).getByRole("button", { name: "View score for Bravo Lab, attempt attempt-bravo" })).toBeTruthy();
    expect(within(cards[1]!).getByRole("heading", { name: "Alpha Lab" })).toBeTruthy();
    expect(cards[0]!.getAttribute("aria-current")).toBeNull();
    expect(cards[1]!.getAttribute("aria-current")).toBe("true");
    expect(within(cards[1]!).getByText("Opened attempt")).toBeTruthy();
    expect(screen.getAllByText("Opened attempt")).toHaveLength(1);
    expect(document.activeElement).not.toBe(within(cards[1]!).getByRole("heading", { name: "Alpha Lab" }));
    expect(within(cards[1]!).getByText("Expired")).toBeTruthy();
    expect(within(alphaFrontFace).queryByText("Attempt ID: attempt-alpha")).toBeNull();
    expect(within(cards[1]!).getByText("This attempt is saved in your history.")).toBeTruthy();
    expect(within(cards[1]!).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Attempt details for Alpha Lab, attempt attempt-alpha",
    ]);
    expect(within(cards[2]!).getByText("Completed")).toBeTruthy();
    expect(within(cards[2]!).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Attempt details for Charlie Lab, attempt attempt-charlie",
    ]);
    expect(screen.queryByRole("button", { name: /Alpha Lab Expired/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Bravo Lab Completed/ })).toBeNull();
    expect(screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-current"))).toHaveLength(1);

    await user.click(within(cards[1]!).getByRole("button", { name: "Attempt details for Alpha Lab, attempt attempt-alpha" }));
    expect(within(cards[1]!).getByText("Attempt ID: attempt-alpha")).toBeTruthy();
    expect(within(cards[1]!).getByText("1440 minute environment retention")).toBeTruthy();
    expect(within(bravoFrontFace).queryByText("Attempt ID: attempt-bravo")).toBeNull();
    expect(screen.getAllByRole("article")).toEqual(cards);
  });

  it("keeps ready waiting and cold-start warning variants readable inside equal card faces", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T16:00:00.000Z"));
    const browserFetch = vi.fn((input: RequestInfo | URL) => String(input) === "/api/candidate/exams"
      ? Promise.resolve(json({
        exams: [
          { id: "exam-now", title: "Immediate Lab", description: "", timeLimitMinutes: 60, openPeriodMinutes: 90, storageLeaseMinutes: 1440, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
          { id: "exam-later", title: "Later Lab", description: "", timeLimitMinutes: 60, openPeriodMinutes: 90, storageLeaseMinutes: 1440, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
        ],
        attempts: [
          { id: "attempt-now", examId: "exam-now", examTitle: "Immediate Lab", scheduledFor: "2026-10-23T16:00:00.000Z", status: "ready" },
          { id: "attempt-later", examId: "exam-later", examTitle: "Later Lab", scheduledFor: "2026-10-23T17:00:00.000Z", status: "ready" },
        ],
      }))
      : Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-now");

    render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: "attempt-now", examId: null }} />);

    await act(async () => { await Promise.resolve(); });
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.style.height === "34rem")).toBe(true);
    expect(cards.every((card) => card.querySelector<HTMLElement>("[data-attempt-slot='next-step']")?.style.overflowY === "auto")).toBe(true);
    expect(screen.getAllByText(COLD_START_WARNING_MESSAGE)).toHaveLength(2);
    expect(screen.getByText("Enter exam becomes available at 2026-10-23 18:00.")).toBeTruthy();
    expect(within(cards[0]!).getByRole("button", { name: /Attempt details for Later Lab/ })).toBeTruthy();
    expect(within(cards[1]!).getByRole("button", { name: /Attempt details for Immediate Lab/ })).toBeTruthy();
  });

  it("keeps current cards in place when background refresh changes their statuses", async () => {
    vi.useFakeTimers();
    let dashboardCalls = 0;
    const exams = [
      { id: "exam-alpha", title: "Alpha Lab", description: "", timeLimitMinutes: 60, openPeriodMinutes: 90, storageLeaseMinutes: 1440, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
      { id: "exam-bravo", title: "Bravo Lab", description: "", timeLimitMinutes: 45, openPeriodMinutes: 60, storageLeaseMinutes: 720, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
    ];
    const browserFetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input) !== "/api/candidate/exams") return Promise.resolve(new Response(null, { status: 200 }));
      dashboardCalls += 1;
      return Promise.resolve(json({
        exams,
        attempts: dashboardCalls === 1
          ? [
            { id: "attempt-alpha", examId: "exam-alpha", examTitle: "Alpha Lab", scheduledFor: "2026-10-23T17:00:00.000Z", status: "suspended" },
            { id: "attempt-bravo", examId: "exam-bravo", examTitle: "Bravo Lab", scheduledFor: "2026-10-23T16:00:00.000Z", status: "in_progress" },
          ]
          : [
            { id: "attempt-alpha", examId: "exam-alpha", examTitle: "Alpha Lab", scheduledFor: "2026-10-23T17:00:00.000Z", status: "in_progress" },
            { id: "attempt-bravo", examId: "exam-bravo", examTitle: "Bravo Lab", scheduledFor: "2026-10-23T16:00:00.000Z", status: "suspended" },
          ],
      }));
    });
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    currentSearchParams = new URLSearchParams("task=current&attemptId=attempt-alpha");

    render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "current", attemptId: "attempt-alpha", examId: null }} />);
    await act(async () => { await Promise.resolve(); });
    const initialCards = screen.getAllByRole("article");
    expect(initialCards.map((card) => card.getAttribute("aria-labelledby"))).toEqual([
      "candidate-attempt-attempt-alpha-title-front",
      "candidate-attempt-attempt-bravo-title-front",
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });

    const refreshedCards = screen.getAllByRole("article");
    expect(refreshedCards).toEqual(initialCards);
    expect(within(refreshedCards[0]!).getByRole("button", { name: "Return to exam for Alpha Lab, attempt attempt-alpha" })).toBeTruthy();
    expect(within(refreshedCards[1]!).getByRole("button", { name: "Resume exam for Bravo Lab, attempt attempt-bravo" })).toBeTruthy();
  });

  it("changes an empty task route without a dashboard reload and clears its fallback warning on Schedule", async () => {
    const user = userEvent.setup();
    const browserFetch = vi.fn((input: RequestInfo | URL) => String(input) === "/api/candidate/exams"
      ? Promise.resolve(json({
        exams: [{ id: "exam-1", title: "Foundations", description: "", timeLimitMinutes: 60, openPeriodMinutes: 60, storageLeaseMinutes: 60, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] }],
        attempts: [],
      }))
      : Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    currentSearchParams = new URLSearchParams("task=schedule&examId=exam-1");
    const rendered = render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "schedule", attemptId: null, examId: "exam-1" }} />);
    await screen.findByRole("heading", { name: "Choose an exam" });

    await user.click(screen.getByRole("button", { name: /^Current Exam Attempt/ }));
    expect(routerPush).not.toHaveBeenCalled();
    expect(window.location.href).toContain("task=current");
    currentSearchParams = new URLSearchParams("task=current");
    rendered.rerender(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "schedule", attemptId: null, examId: "exam-1" }} />);
    expect(await screen.findByText(/No live Exam Attempt is available/)).toBeTruthy();

    await user.click(within(screen.getByRole("region", { name: "Candidate delivery tasks" })).getByRole("button", { name: /^Schedule exam/ }));
    currentSearchParams = new URLSearchParams("task=schedule&examId=exam-1");
    rendered.rerender(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "schedule", attemptId: null, examId: "exam-1" }} />);
    await waitFor(() => expect(screen.queryByText(/No live Exam Attempt is available/)).toBeNull());
    expect(browserFetch.mock.calls.filter(([input]) => String(input) === "/api/candidate/exams")).toHaveLength(1);
    expect(screen.queryByText("Loading candidate dashboard...")).toBeNull();
  });

  it("uses candidate-facing Exam Attempt copy instead of the domain identifier", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/candidate/exams"
      ? Promise.resolve(json({ exams: [], attempts: [] }))
      : Promise.resolve(new Response(null, { status: 200 }))));
    currentSearchParams = new URLSearchParams("task=history");
    const { container } = render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "history", attemptId: null, examId: null }} />);

    await screen.findByRole("button", { name: /^Current Exam Attempt/ });
    expect(container.textContent).not.toContain("ExamAttempt");
    expect(container.textContent).toContain("No completed Exam Attempt history is available yet.");
  });

  it("uses the detailed exam cards as the only Schedule selection surface", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input) === "/api/candidate/exams"
      ? Promise.resolve(json({
        exams: [
          { id: "exam-individual", title: "Alpha individual", description: "", timeLimitMinutes: 60, openPeriodMinutes: 90, storageLeaseMinutes: 60, scoreRetrievalEnabled: false, individualSchedulingEnabled: true, availableCohortSessions: [] },
          { id: "exam-live", title: "Beta live exam", description: "", timeLimitMinutes: 30, openPeriodMinutes: 30, storageLeaseMinutes: 60, scoreRetrievalEnabled: false, individualSchedulingEnabled: false, availableCohortSessions: [{ id: "session-1", name: "Live session", admissionStartsAt: "2026-06-16T15:00:00.000Z", admissionEndsAt: null }] },
        ],
        attempts: [],
      }))
      : Promise.resolve(new Response(null, { status: 200 }))));
    currentSearchParams = new URLSearchParams("task=schedule");
    render(<CandidateHome email="candidate@helioscx.demo" initialRoute={{ task: "schedule", attemptId: null, examId: null }} />);

    expect(await screen.findByRole("heading", { name: "Alpha individual" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Beta live exam" })).toBeTruthy();
    const scheduleSection = screen.getByRole("heading", { name: "Choose an exam" }).closest("section");
    expect(scheduleSection).not.toBeNull();
    const scheduleButtons = within(scheduleSection as HTMLElement).getAllByRole("button");
    // Each detailed card owns its action controls; the removed selector strip
    // would add one extra exam button per published Exam here.
    expect(scheduleButtons).toHaveLength(4);
    expect(screen.getByText("Schedule date and time")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Schedule exam" })).toBeTruthy();
    expect(screen.getByText("Ready to start")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Start exam|Join/i })).toBeTruthy();
  });
});
