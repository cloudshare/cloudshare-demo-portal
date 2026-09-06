/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const watchdogCallbacks = vi.hoisted(() => [] as Array<() => void>);
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./session-expiry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session-expiry")>();
  return {
    ...actual,
    startPortalSessionWatchdog: ({ onExpired }: { readonly onExpired: () => void }) => {
      watchdogCallbacks.push(onExpired);
      return { checkNow: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
    },
  };
});
import { AdminConsole } from "./admin-console";
import { CandidateHome } from "./candidate-home";
import { CandidateLabShell } from "./candidate-lab-shell";
import { SalesTrialHome } from "./sales-trial-home";
import { SalesWorkspace } from "./sales-workspace";
import { ScoreDisplay } from "./score-display";
import { ProtectedPortalFallback } from "./protected-portal-fallback";
import { SalesWorkspaceChrome } from "./sales-workspace-chrome";
import { SalesSessionWorkspace } from "./sales-session-workspace";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expireLatestWatchdog(): Promise<void> {
  const callback = watchdogCallbacks.at(-1);
  expect(callback).toBeTypeOf("function");
  await act(async () => callback!());
}

describe("idle expiry on protected portal surfaces", () => {
  beforeEach(() => {
    watchdogCallbacks.length = 0;
    router.push.mockClear();
    router.replace.mockClear();
    router.refresh.mockClear();
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/candidate/exams")) return json({ exams: [], attempts: [] });
      if (url.startsWith("/api/exam/status")) return json({
        examAttemptId: "attempt-1", examTitle: "Foundations", status: "ready",
        timeLimitMinutes: 60, scheduledFor: null, openPeriodEndsAt: null, openPeriodClosed: false,
      });
      if (url.startsWith("/api/exam/score")) return json({
        examAttemptId: "attempt-1", examTitle: "Foundations", scheduledFor: null,
        experienceId: "experience-1", scoreRetrievalEnabled: false, scoreAvailable: false,
        reason: "score_retrieval_disabled", message: "Score unavailable.",
        retrievedAt: "2026-09-05T10:00:00.000Z", limitations: [],
      });
      return json({ candidates: [], entries: [], records: [], offerings: [] });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("removes an idle Helios Admin console", async () => {
    window.history.replaceState({}, "", "/admin?tab=candidates");
    render(<AdminConsole email="admin@helioscx.demo" initialTab="candidates" />);
    expect(screen.getByText("Certalis Admin Console")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Certalis Admin Console")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login?returnTo=%2Fadmin%3Ftab%3Dcandidates");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("removes an idle Sales Admin workspace", async () => {
    window.history.replaceState({}, "", "/sales?tab=items");
    render(<SalesWorkspace email="sales-admin@certalis.demo" initialRoute={{ tab: "items", itemView: "catalog" }} />);
    expect(screen.getByRole("complementary", { name: "Sales workspace navigation" })).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByRole("complementary", { name: "Sales workspace navigation" })).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login?returnTo=%2Fsales%3Ftab%3Ditems");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("removes an idle dedicated Session workspace chrome and child", async () => {
    window.history.replaceState({}, "", "/sales/sessions/session-1?area=activity");
    render(<SalesWorkspaceChrome email="sales-admin@certalis.demo" activeTab="sessions"><p>Protected Session content</p></SalesWorkspaceChrome>);
    expect(screen.getByText("Protected Session content")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Protected Session content")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Sales workspace navigation" })).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("unmounts the composed Session workspace once after a request-time 401 without replay", async () => {
    window.history.replaceState({}, "", "/sales/sessions/session-1?area=activity");
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/workspace")) return new Response(JSON.stringify({ error: "Session expired" }), { status: 401 });
      return json({ session: { expiresAtMs: Date.now() + 60_000 }, serverNowMs: Date.now() });
    });
    render(<SalesWorkspaceChrome email="sales-admin@certalis.demo" activeTab="sessions"><SalesSessionWorkspace sessionId="session-1" area="activity" queueHref="/sales?tab=sessions" /></SalesWorkspaceChrome>);
    await screen.findByText("Your session has expired. Sign in again to continue.");
    expect(screen.queryByRole("complementary", { name: "Sales workspace navigation" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Activity" })).toBeNull();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).includes("/workspace"))).toHaveLength(1);
  });

  it("removes an idle Candidate home", async () => {
    window.history.replaceState({}, "", "/candidate");
    render(<CandidateHome email="candidate@helioscx.demo" />);
    expect(screen.getByText("Certalis Candidate Portal")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Certalis Candidate Portal")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login?returnTo=%2Fcandidate");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("removes an idle Sales Trial Participant portal", async () => {
    window.history.replaceState({}, "", "/sales-trial");
    render(<SalesTrialHome email="visitor@example.test" initialOfferings={[{
      id: "offering-1", title: "Trial", description: "Safe trial", start: "2026-09-05T10:00:00.000Z", end: null, timeZone: "UTC",
    }]} />);
    expect(screen.getByText("Certalis Sales Trial")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Certalis Sales Trial")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/sales-trial/login?returnTo=%2Fsales-trial");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("removes an idle Candidate Lab nested surface", async () => {
    window.history.replaceState({}, "", "/candidate/lab?examAttemptId=attempt-1");
    render(<CandidateLabShell email="candidate@helioscx.demo" examAttemptId="attempt-1" initialAttemptStatus="ready" />);
    expect(screen.getByText("Candidate lab")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Candidate lab")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("unmounts Candidate Lab after a status refresh 401 without retrying the refresh", async () => {
    window.history.replaceState({}, "", "/candidate/lab?examAttemptId=attempt-1");
    let statusCalls = 0;
    const fetchSpy = vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/exam/status")) { statusCalls += 1; return statusCalls > 1 ? json({ error: "Session expired" }, 401) : json({ examAttemptId: "attempt-1", examTitle: "Foundations", status: "ready", timeLimitMinutes: 60, scheduledFor: null, openPeriodEndsAt: null, openPeriodClosed: false }); }
      if (url.includes("/api/exam/suspend")) return json({ error: "Session expired" }, 401);
      if (url.includes("/api/heartbeat")) return json({});
      return json({ session: { expiresAtMs: Date.now() + 60_000 }, serverNowMs: Date.now() });
    });
    render(<CandidateLabShell email="candidate@helioscx.demo" examAttemptId="attempt-1" initialAttemptStatus="in_progress" />);
    await screen.findByRole("button", { name: "Enter exam" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Enter exam" }));
    await act(async () => await Promise.resolve());
    expect(statusCalls).toBe(2);
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).includes("/api/exam/status"))).toHaveLength(2);
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByText("Candidate lab")).toBeNull();
  });

  it("removes an idle Candidate Score nested surface", async () => {
    window.history.replaceState({}, "", "/candidate/score?examAttemptId=attempt-1");
    render(<ScoreDisplay email="candidate@helioscx.demo" examAttemptId="attempt-1" />);
    expect(screen.getByText("Candidate score")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Candidate score")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["Launch lab", "Missing examAttemptId."],
    ["Session complete", "Missing examAttemptId."],
  ])("removes an idle malformed Candidate fallback: %s", async (title, message) => {
    window.history.replaceState({}, "", "/candidate/invalid");
    render(<ProtectedPortalFallback title={title} message={message} />);
    expect(screen.getByText(title)).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText(title)).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

