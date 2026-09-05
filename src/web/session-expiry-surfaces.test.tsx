/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
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

  it("removes an idle Candidate Score nested surface", async () => {
    window.history.replaceState({}, "", "/candidate/score?examAttemptId=attempt-1");
    render(<ScoreDisplay email="candidate@helioscx.demo" examAttemptId="attempt-1" />);
    expect(screen.getByText("Candidate score")).not.toBeNull();
    await expireLatestWatchdog();
    expect(screen.queryByText("Candidate score")).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
