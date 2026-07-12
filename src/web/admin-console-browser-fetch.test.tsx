/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AdminConsole } from "./admin-console";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
}));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminConsole browser request dispatch", () => {
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
});
