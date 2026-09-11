/** @vitest-environment jsdom */
import React, { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesSessionWorkspace } from "./sales-session-workspace";
import { SalesWorkspaceChrome } from "./sales-workspace-chrome";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./session-expiry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session-expiry")>();
  return {
    ...actual,
    startPortalSessionWatchdog: () => ({ checkNow: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
  };
});

const workspace = {
  summary: {
    id: "session-1", sessionName: "Current session", revision: 3,
    start: "2026-07-24T09:00:00.000Z", end: "2026-07-24T10:00:00.000Z", timeZone: "UTC",
    operation: { value: "correlated", source: "certalis_persistence" },
    experience: { value: "inProgress", source: "cloudshare_v4_get_sales", freshness: "fresh", observedAt: "2026-07-24T09:01:00.000Z" },
  },
  participants: [],
  activity: [],
  activityGroups: [],
  details: { accountName: "Acme", opportunityName: "Evaluation", itemName: "Enablement", invitationMode: "Sales Pros and participants" },
};

const staleWorkspace = { ...workspace, summary: { ...workspace.summary, experience: { value: "notStarted", source: "schedule_prediction", freshness: "predicted" } } };
const replacementWorkspace = { ...workspace, summary: { ...workspace.summary, id: "session-2", sessionName: "Replacement session" } };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderComposed(sessionId = "session-1", area: "participants" | "activity" = "participants") {
  return render(
    <StrictMode>
      <SalesWorkspaceChrome email="sales-admin@certalis.demo" activeTab="sessions">
        <SalesSessionWorkspace sessionId={sessionId} area={area} queueHref="/sales?tab=sessions" />
      </SalesWorkspaceChrome>
    </StrictMode>,
  );
}

describe("composed Sales Session shell expiry", () => {
  beforeEach(() => {
    router.replace.mockClear();
    router.refresh.mockClear();
    window.history.replaceState({}, "", "/sales/sessions/session-1?area=participants");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the replacement when the old initial workspace GET returns 401", async () => {
    let releaseOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => { releaseOld = resolve; });
    const paths: string[] = [];
    const fetchMock = vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input); paths.push(path);
      return path.includes("session-1") ? old : response(replacementWorkspace);
    });
    const rendered = renderComposed("session-1", "activity");
    rendered.rerender(
      <StrictMode><SalesWorkspaceChrome email="sales-admin@certalis.demo" activeTab="sessions"><SalesSessionWorkspace sessionId="session-2" area="activity" queueHref="/sales?tab=sessions" /></SalesWorkspaceChrome></StrictMode>,
    );
    expect(await screen.findByRole("heading", { name: "Replacement session" })).not.toBeNull();
    releaseOld(response({ error: "Session expired" }, 401));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Replacement session" })).not.toBeNull();
    expect(paths.filter((path) => path.includes("/workspace"))).toEqual(expect.arrayContaining([
      "/api/sales/enablement-sessions/session-1/workspace",
      "/api/sales/enablement-sessions/session-2/workspace",
    ]));
  });

  it.each(["post", "reread"] as const)("does not expire the shell for an old automatic refresh %s 401", async (phase) => {
    let releaseOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => { releaseOld = resolve; });
    const paths: string[] = [];
    let refreshStarted = false;
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input); paths.push(`${init?.method ?? "GET"} ${path}`);
      if (path.includes("session-1/workspace") && !refreshStarted) return response(staleWorkspace);
      if (path.includes("refresh?mode=automatic") && !path.includes("targetId=session-2")) {
        refreshStarted = true;
        if (phase === "post") return old;
        return response({ correlationId: "old-refresh" });
      }
      if (phase === "reread" && path.includes("session-1/workspace")) return old;
      return response(replacementWorkspace);
    });
    const rendered = renderComposed("session-1");
    await screen.findByRole("heading", { name: "Participants" });
    await waitFor(() => expect(paths.some((path) => path.includes("refresh?mode=automatic"))).toBe(true));
    rendered.rerender(
      <StrictMode><SalesWorkspaceChrome email="sales-admin@certalis.demo" activeTab="sessions"><SalesSessionWorkspace sessionId="session-2" area="participants" queueHref="/sales?tab=sessions" /></SalesWorkspaceChrome></StrictMode>,
    );
    await screen.findByRole("heading", { name: "Replacement session" });
    releaseOld(response({ error: "Session expired" }, 401));
    await waitFor(() => expect(paths.some((path) => path.includes("session-2/workspace"))).toBe(true));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Replacement session" })).not.toBeNull();
    expect(paths).toContain("GET /api/sales/enablement-sessions/session-1/workspace");
    expect(paths).toContain("POST /api/sales/enablement-sessions/refresh?mode=automatic&targetId=session-1&limit=1");
  });

  it("does not expire the shell for an old Verify POST 401", async () => {
    let releaseVerify!: (value: Response) => void;
    const verify = new Promise<Response>((resolve) => { releaseVerify = resolve; });
    const paths: string[] = [];
    vi.spyOn(window, "fetch").mockImplementation(async (input, init) => {
      const path = String(input); paths.push(`${init?.method ?? "GET"} ${path}`);
      if (path.includes("/verify")) return verify;
      return response(path.includes("session-2") ? replacementWorkspace : workspace);
    });
    const user = userEvent.setup();
    const rendered = renderComposed();
    await screen.findByRole("heading", { name: "Participants" });
    await user.click(screen.getByRole("button", { name: "Verify now" }));
    rendered.rerender(
      <StrictMode><SalesWorkspaceChrome email="sales-admin@certalis.demo" activeTab="sessions"><SalesSessionWorkspace sessionId="session-2" area="participants" queueHref="/sales?tab=sessions" /></SalesWorkspaceChrome></StrictMode>,
    );
    await screen.findByRole("heading", { name: "Replacement session" });
    releaseVerify(response({ error: "Session expired" }, 401));
    await waitFor(() => expect(paths.some((path) => path.includes("session-2/workspace"))).toBe(true));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/old-verify|Verifying this Sales Session/)).toBeNull();
    expect(paths).toContain("POST /api/sales/enablement-sessions/session-1/verify");
  });

  it("expires the composed shell once for a current Session 401", async () => {
    const paths: string[] = [];
    vi.spyOn(window, "fetch").mockImplementation(async (input) => {
      const path = String(input); paths.push(path);
      return path.includes("/workspace") ? response({ error: "Session expired" }, 401) : response({});
    });
    renderComposed("session-1", "activity");
    await screen.findByText("Your session has expired. Sign in again to continue.");
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(paths.filter((path) => path.includes("/workspace")).length).toBeGreaterThanOrEqual(1);
  });
});
