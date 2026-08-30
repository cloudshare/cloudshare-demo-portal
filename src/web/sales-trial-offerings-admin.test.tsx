/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SalesTrialOfferingsAdmin } from "./sales-trial-offerings-admin";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("Sales Trial Offerings admin monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads published-offering participant monitoring on demand without exposing provider ids", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sales/items") return json({ activeItems: [] });
      if (url === "/api/sales/timezones") return json({ timezones: [] });
      if (url === "/api/sales/trial-offerings") {
        return json({
          offerings: [
            {
              id: "offering-1",
              title: "Helios Trial",
              description: "Shared trial",
              itemId: "item-1",
              start: "2026-08-30T09:00",
              end: "2026-08-30T17:00",
              timeZone: "UTC",
              salesProEmail: "owner@example.test",
              salesProDisplayName: "Owner",
              status: "published",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/participants") {
        return json({
          participants: [
            {
              id: "enrollment-1",
              firstName: "Ari",
              lastName: "Visitor",
              email: "visitor@example.test",
              participationStatus: "inProgress",
              firstJoined: "2026-08-30T10:05:00.000Z",
              envStatus: "Ready",
              environment: {
                dimension: "cloudshare_environment",
                value: "Ready",
                source: "cloudshare_v4_sales_participant_roster",
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open monitoring" }));

    expect(await screen.findByText("Participant monitoring")).toBeTruthy();
    expect(screen.getByText("Ari Visitor")).toBeTruthy();
    expect(screen.getByText("visitor@example.test")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("remote-1")).toBeNull();
  });

  it("renders monitoring inside an overflow-safe constrained-width container", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sales/items") return json({ activeItems: [] });
      if (url === "/api/sales/timezones") return json({ timezones: [] });
      if (url === "/api/sales/trial-offerings") {
        return json({
          offerings: [
            {
              id: "offering-1",
              title: "Helios Trial",
              description: "Shared trial",
              itemId: "item-1",
              start: "2026-08-30T09:00",
              end: "2026-08-30T17:00",
              timeZone: "UTC",
              salesProEmail: "owner@example.test",
              salesProDisplayName: "Owner",
              status: "published",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/participants") {
        return json({ participants: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open monitoring" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Participant monitoring")).toBeTruthy();
    });

    const region = screen.getByLabelText("Participant monitoring");
    expect(region.getAttribute("style")).toContain("overflow-x: auto");
    expect(region.getAttribute("style")).toContain("width: 100%");
  });
});
