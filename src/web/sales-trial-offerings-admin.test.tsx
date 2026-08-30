/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("retains manual datetime-local entry in state and sends it in the draft payload without requiring blur", async () => {
    const capturedBodies: unknown[] = [];
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales/items") {
        return json({
          activeItems: [{ id: "item-1", name: "Accelerate Trial", defaultDurationMinutes: 1440 }],
        });
      }
      if (url === "/api/sales/timezones") {
        return json({ timezones: [{ id: "UTC", name: "UTC" }] });
      }
      if (url === "/api/sales/enablement-sessions/project-members?itemId=item-1") {
        return json({
          members: [{ email: "owner@example.test", displayName: "Owner Example" }],
        });
      }
      if (url === "/api/sales/trial-offerings" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        capturedBodies.push(body);
        return json({
          offering: {
            id: "offering-1",
            title: body.title,
            description: body.description,
            itemId: body.itemId,
            start: body.start,
            end: body.end,
            timeZone: body.timeZone,
            salesProEmail: body.salesProEmail,
            salesProDisplayName: "Owner Example",
            status: "draft",
            attentionReason: null,
          },
        }, { status: 201 });
      }
      if (url === "/api/sales/trial-offerings") {
        return json({ offerings: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "Helios Trial");
    await user.type(screen.getByLabelText("Description"), "Shared trial");
    await user.selectOptions(screen.getByLabelText("Item"), "item-1");
    await user.selectOptions(
      await screen.findByLabelText("Sales Pro"),
      "owner@example.test",
    );

    const start = screen.getByLabelText("Start") as HTMLInputElement;
    const end = screen.getByLabelText("End") as HTMLInputElement;

    fireEvent.input(start, { target: { value: "2026-09-01T09:00" } });
    fireEvent.input(end, { target: { value: "2026-09-01T17:00" } });

    expect(start.value).toBe("2026-09-01T09:00");
    expect(end.value).toBe("2026-09-01T17:00");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(capturedBodies).toEqual([
        {
          title: "Helios Trial",
          description: "Shared trial",
          itemId: "item-1",
          start: "2026-09-01T09:00",
          end: "2026-09-01T17:00",
          noEndDate: false,
          timeZone: "UTC",
          salesProEmail: "owner@example.test",
        },
      ]);
    });
    expect((await screen.findByRole("status")).textContent).toContain("Trial Offering draft saved.");
  });

  it("sends an explicit open-ended draft payload and disables the end field when no end date is selected", async () => {
    const capturedBodies: unknown[] = [];
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales/items") {
        return json({
          activeItems: [{ id: "item-1", name: "Accelerate Trial", defaultDurationMinutes: 1440 }],
        });
      }
      if (url === "/api/sales/timezones") {
        return json({ timezones: [{ id: "UTC", name: "UTC" }] });
      }
      if (url === "/api/sales/enablement-sessions/project-members?itemId=item-1") {
        return json({
          members: [{ email: "owner@example.test", displayName: "Owner Example" }],
        });
      }
      if (url === "/api/sales/trial-offerings" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        capturedBodies.push(body);
        return json({
          offering: {
            id: "offering-1",
            title: body.title,
            description: body.description,
            itemId: body.itemId,
            start: body.start,
            end: body.end,
            timeZone: body.timeZone,
            salesProEmail: body.salesProEmail,
            salesProDisplayName: "Owner Example",
            status: "draft",
            attentionReason: null,
          },
        }, { status: 201 });
      }
      if (url === "/api/sales/trial-offerings") {
        return json({ offerings: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Title"), "Helios Trial");
    await user.type(screen.getByLabelText("Description"), "Shared trial");
    await user.selectOptions(screen.getByLabelText("Item"), "item-1");
    await user.selectOptions(
      await screen.findByLabelText("Sales Pro"),
      "owner@example.test",
    );

    const start = screen.getByLabelText("Start") as HTMLInputElement;
    fireEvent.input(start, { target: { value: "2026-09-01T09:00" } });
    await user.click(screen.getByLabelText("No end date"));

    const end = screen.getByLabelText("End") as HTMLInputElement;
    expect(end.disabled).toBe(true);
    expect(end.value).toBe("");

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(capturedBodies).toEqual([
        {
          title: "Helios Trial",
          description: "Shared trial",
          itemId: "item-1",
          start: "2026-09-01T09:00",
          end: null,
          noEndDate: true,
          timeZone: "UTC",
          salesProEmail: "owner@example.test",
        },
      ]);
    });
  });

  it("sends the end-trial action only after confirmation and refreshes the offering list", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
              end: null,
              timeZone: "UTC",
              salesProEmail: "owner@example.test",
              salesProDisplayName: "Owner",
              status: "published",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/end" && init?.method === "POST") {
        return json({
          offering: {
            id: "offering-1",
            title: "Helios Trial",
            description: "Shared trial",
            itemId: "item-1",
            start: "2026-08-30T09:00",
            end: "2026-08-30T12:32",
            timeZone: "UTC",
            salesProEmail: "owner@example.test",
            salesProDisplayName: "Owner",
            status: "unpublished",
            attentionReason: null,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "End trial" }));

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith(
        "/api/sales/trial-offerings/offering-1/end",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toContain("Trial Offering ended.");
  });
});
