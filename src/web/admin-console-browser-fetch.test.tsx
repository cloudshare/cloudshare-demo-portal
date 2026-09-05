/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminConsole } from "./admin-console";

const routerPush = vi.fn();
const routerReplace = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
    refresh: routerRefresh,
  }),
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminConsole browser request dispatch", () => {
  it("replaces the rendered Admin view with its safe login return target after a 401", async () => {
    const originalWindowFetch = window.fetch;
    const browserFetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== window) {
        throw new TypeError("Browser fetch must retain its Window receiver");
      }

      switch (String(input)) {
        case "/api/auth/session":
          return Promise.resolve(json({}));
        case "/api/admin/cloudshare":
          return Promise.resolve(json({ hasConnection: true, connectedAt: null, verifiedAt: null, webhookPath: null }));
        case "/api/admin/exams":
          return Promise.resolve(new Response(null, { status: 401 }));
        default:
          throw new Error(`Unexpected browser fetch: ${String(input)}`);
      }
    });

    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: browserFetch,
      writable: true,
    });

    try {
      window.history.replaceState({}, "", "/admin");
      render(<AdminConsole email="admin@helioscx.demo" />);

      await waitFor(() => expect(routerReplace).toHaveBeenCalled());
      expect(screen.queryByRole("heading", { name: "Admin session expired" })).toBeNull();
      expect(routerReplace).toHaveBeenCalledWith("/login?returnTo=%2Fadmin");
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: originalWindowFetch,
        writable: true,
      });
    }
  });

  it("loads the Exam Catalog through the browser-owned fetch receiver", async () => {
    const originalWindowFetch = window.fetch;
    const browserFetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== window) {
        throw new TypeError("Browser fetch must retain its Window receiver");
      }

      switch (String(input)) {
        case "/api/auth/session":
          return Promise.resolve(json({}));
        case "/api/admin/cloudshare":
          return Promise.resolve(json({ hasConnection: true, connectedAt: null, verifiedAt: null, webhookPath: null }));
        case "/api/admin/exams":
          return Promise.resolve(json({
            activeExams: [{
              id: "exam-1",
              title: "Helios Foundations",
              description: "Shared practice lab",
              timeLimitMinutes: 90,
              openPeriodMinutes: 120,
              scoreRetrievalEnabled: false,
              deliveryAvailability: "individual",
              status: "published",
              publishedAt: "2026-09-01T00:00:00.000Z",
              projectId: "project-1",
              projectName: "Project Atlas",
              blueprintId: "blueprint-1",
              blueprintName: "Blueprint Aurora",
              snapshotId: "snapshot-1",
              snapshotName: "Snapshot Echo",
              allowedRegions: [],
              policyId: "policy-1",
              policyName: "Policy Orbit",
              instructorName: "Jordan Lee",
            }],
            archivedExams: [],
          }));
        default:
          throw new Error(`Unexpected browser fetch: ${String(input)}`);
      }
    });

    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: browserFetch,
      writable: true,
    });

    try {
      render(<AdminConsole email="admin@helioscx.demo" />);

      expect(await screen.findByText("Helios Foundations")).toBeTruthy();
      expect(browserFetch).toHaveBeenCalledWith("/api/admin/exams", undefined);
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: originalWindowFetch,
        writable: true,
      });
    }
  });

  it("keeps a deleted Exam edit deep link out of create-capable authoring", async () => {
    const originalWindowFetch = window.fetch;
    const browserFetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== window) throw new TypeError("Browser fetch must retain its Window receiver");
      if (String(input) === "/api/admin/exams") return Promise.resolve(json({ activeExams: [], archivedExams: [] }));
      if (String(input).startsWith("/api/admin/exam-authoring/")) return Promise.resolve(json({ projects: [], regions: [] }));
      throw new Error(`Unexpected browser fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    try {
      render(<AdminConsole email="admin@helioscx.demo" initialExamView="edit" initialExamId="missing-exam" />);
      expect(await screen.findByText("That Exam is no longer available.")).toBeTruthy();
      expect(screen.queryByText("Project-first Exam authoring")).toBeNull();
      expect(screen.queryByRole("button", { name: "Create Exam" })).toBeNull();
      expect(screen.getByRole("button", { name: "Return to Exam catalog" })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "fetch", { configurable: true, value: originalWindowFetch, writable: true });
    }
  });

  it("moves focus to the admin content landmark when the route-backed view changes", async () => {
    const originalWindowFetch = window.fetch;
    const browserFetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== window) throw new TypeError("Browser fetch must retain its Window receiver");
      return Promise.resolve(json(String(input).includes("/api/admin/exams") ? { activeExams: [], archivedExams: [] } : {}));
    });
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    try {
      const first = render(<AdminConsole email="admin@helioscx.demo" />);
      const content = await screen.findByRole("main");
      await waitFor(() => expect(content.querySelector("[data-route-focus]")).toBeTruthy());
      first.unmount();
      const second = render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="diagnostics" />);
      const nextContent = await screen.findByRole("main");
      await waitFor(() => expect(document.activeElement).toBe(nextContent.querySelector("[data-route-focus]")));
      second.unmount();
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "fetch", { configurable: true, value: originalWindowFetch, writable: true });
    }
  });

  it("explains stale Exam Session and Support Monitoring targets instead of showing aggregate fallbacks", async () => {
    const originalWindowFetch = window.fetch;
    const browserFetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      if (this !== window) throw new TypeError("Browser fetch must retain its Window receiver");
      if (String(input) === "/api/admin/exams") return Promise.resolve(json({ activeExams: [{ id: "exam-1", title: "Helios Foundations", description: "", timeLimitMinutes: 90, openPeriodMinutes: 120, scoreRetrievalEnabled: false, deliveryAvailability: "cohort", status: "published", publishedAt: null, projectId: "p", projectName: "Project", blueprintId: "b", blueprintName: "Blueprint", snapshotId: "s", snapshotName: "Snapshot", allowedRegions: [], policyId: "policy", policyName: "Policy", instructorName: "Instructor" }], archivedExams: [] }));
      if (String(input).includes("/cohort-sessions")) return Promise.resolve(json({ sessions: [] }));
      if (String(input).includes("/api/admin/monitoring")) return Promise.resolve(json({ monitoring: { attempts: [], historyPage: { entries: [], nextOffset: null } } }));
      return Promise.resolve(json({}));
    });
    vi.stubGlobal("fetch", browserFetch);
    Object.defineProperty(window, "fetch", { configurable: true, value: browserFetch, writable: true });
    try {
      const first = render(<AdminConsole email="admin@helioscx.demo" initialExamView="sessions" initialExamId="exam-1" initialCohortSessionId="missing-session" />);
      expect((await screen.findAllByRole("alert")).some((alert) => alert.textContent?.includes("The requested Cohort Exam Session is no longer available."))).toBe(true);
      first.unmount();
      render(<AdminConsole email="admin@helioscx.demo" initialTab="support" initialSupportView="monitoring" initialDeliveryView="cohort" initialExamId="exam-1" initialCohortSessionId="missing-session" />);
      expect((await screen.findAllByRole("alert")).some((alert) => alert.textContent?.includes("The requested Cohort Exam Session is no longer available."))).toBe(true);
      expect(screen.queryByText("No Cohort Exam Sessions match the current monitoring view.")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "fetch", { configurable: true, value: originalWindowFetch, writable: true });
    }
  });
});
