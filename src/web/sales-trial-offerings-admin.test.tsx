/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSessionExpiredError } from "./admin-authenticated-request";
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
          observation: {
            freshness: "live",
            source: "cloudshare_v4_sales_participant_roster",
            observedAt: "2026-08-30T10:06:00.000Z",
          },
          participants: [
            {
              id: "enrollment-1",
              firstName: "Ari",
              lastName: "Visitor",
              email: "visitor@example.test",
              invitationStatus: "notSent",
              participationStatus: "inProgress",
              firstJoined: "2026-08-30T10:05:00.000Z",
              envStatus: "Ready",
              extend: {
                enabled: true,
                reason: null,
              },
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
    expect(screen.getByText("Not sent")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Observed from CloudShare participant roster · 2026-08-30T10:06:00.000Z")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extend environment for Ari Visitor" })).toBeTruthy();
    expect(screen.queryByText("remote-1")).toBeNull();
  });

  it("disables extension when monitoring explains the retained row is not eligible", async () => {
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
              status: "ended",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/participants") {
        return json({
          observation: {
            freshness: "stale",
            source: "certalis_sales_trial_enrollment_reconciliation",
            observedAt: "2026-08-30T10:06:00.000Z",
          },
          participants: [
            {
              id: "enrollment-1",
              firstName: "Ari",
              lastName: "Visitor",
              email: "visitor@example.test",
              invitationStatus: "notSent",
              participationStatus: "concluded",
              firstJoined: "2026-08-30T10:05:00.000Z",
              envStatus: "Deleted",
              extend: {
                enabled: false,
                reason:
                  "A retained CloudShare environment mapping is required before Certalis can request an extension.",
              },
              environment: {
                dimension: "cloudshare_environment",
                value: null,
                source: "not_observed",
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

    const button = await screen.findByRole("button", { name: "Extend environment for Ari Visitor" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBe("extend-reason-enrollment-1");
    expect(button.getAttribute("title")).toContain("retained CloudShare environment mapping");
    expect(screen.getByText("A retained CloudShare environment mapping is required before Certalis can request an extension.")).toBeTruthy();
  });

  it("shows an in-flight extend action, refreshes monitoring after success, and preserves a safe response surface", async () => {
    let monitoringReadCount = 0;
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
              end: "2026-08-30T17:00",
              timeZone: "UTC",
              salesProEmail: "owner@example.test",
              salesProDisplayName: "Owner",
              status: "ended",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/participants") {
        monitoringReadCount += 1;
        return json({
          observation: {
            freshness: "stale",
            source: "certalis_sales_trial_enrollment_reconciliation",
            observedAt:
              monitoringReadCount === 1
                ? "2026-08-30T10:06:00.000Z"
                : "2026-08-30T10:09:00.000Z",
          },
          participants: [
            {
              id: "enrollment-1",
              firstName: "Ari",
              lastName: "Visitor",
              email: "visitor@example.test",
              invitationStatus: "sent",
              participationStatus: "inProgress",
              firstJoined: "2026-08-30T10:05:00.000Z",
              envStatus: monitoringReadCount === 1 ? "Archived" : "Ready",
              extend: {
                enabled: true,
                reason: null,
              },
              observation: {
                freshness: "stale",
                source: "certalis_sales_trial_enrollment_reconciliation",
                observedAt:
                  monitoringReadCount === 1
                    ? "2026-08-30T10:06:00.000Z"
                    : "2026-08-30T10:09:00.000Z",
              },
              environment: {
                dimension: "cloudshare_environment",
                value: monitoringReadCount === 1 ? "Archived" : "Ready",
                source: "certalis_sales_trial_enrollment_reconciliation",
                observedAt:
                  monitoringReadCount === 1
                    ? "2026-08-30T10:06:00.000Z"
                    : "2026-08-30T10:09:00.000Z",
              },
            },
          ],
          correlationId: `corr-monitor-${monitoringReadCount}`,
        });
      }
      if (
        url === "/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend" &&
        init?.method === "POST"
      ) {
        return json({
          participant: {
            id: "enrollment-1",
          },
          correlationId: "corr-extend-1",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open monitoring" }));

    const button = await screen.findByRole("button", { name: "Extend environment for Ari Visitor" });
    await user.click(button);

    await waitFor(() => {
      expect(fetchAdmin).toHaveBeenCalledWith(
        "/api/sales/trial-offerings/offering-1/participants/enrollment-1/extend",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect((await screen.findByRole("status")).textContent).toContain("Sales Trial environment extended.");
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByText("env-1")).toBeNull();
  });

  it("shows the calculated end and reconciliation freshness while an offering is Ending", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sales/items") return json({ activeItems: [] });
      if (url === "/api/sales/timezones") return json({ timezones: [] });
      if (url === "/api/sales/trial-offerings") return json({ offerings: [{
        id: "offering-ending", title: "Ending Trial", description: "", itemId: "item-1",
        start: "2026-08-31T09:00", end: "2026-09-01T14:35", timeZone: "UTC",
        salesProEmail: "owner@example.test", salesProDisplayName: "Owner", status: "ending",
        attentionReason: null, endingCalculatedEnd: "2026-09-01T14:35",
        endingLastReconciledAt: "2026-08-31T12:00:00.000Z",
      }] });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);
    expect(await screen.findByText(/scheduled to remain available until 2026-09-01T14:35/)).toBeTruthy();
    expect(screen.getByText("Last reconciled: 2026-08-31T12:00:00.000Z")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open monitoring" })).toBeTruthy();
  });

  it("keeps monitoring visible for an ended offering and labels stale retained history when the roster cannot be refreshed", async () => {
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
              status: "ended",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/participants") {
        return json({
          offering: { id: "offering-1", status: "ended" },
          observation: {
            freshness: "stale",
            source: "certalis_sales_trial_enrollment_reconciliation",
            observedAt: "2026-08-30T10:07:00.000Z",
            warning: "CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.",
          },
        participants: [
          {
            id: "enrollment-1",
            subject: { type: "sales_trial_enrollment", id: "enrollment-1" },
            firstName: "Ari",
            lastName: "Visitor",
            email: "visitor@example.test",
            participationStatus: "inProgress",
            observation: {
              freshness: "stale",
              source: "certalis_sales_trial_enrollment_reconciliation",
              observedAt: "2026-08-30T10:07:00.000Z",
            },
            firstJoined: "2026-08-30T10:05:00.000Z",
            envStatus: "Suspended",
            environment: {
                dimension: "cloudshare_environment",
                value: "Suspended",
                source: "certalis_sales_trial_enrollment_reconciliation",
                observedAt: "2026-08-30T10:07:00.000Z",
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
    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(screen.getByText("CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Observed from locally reconciled history · 2026-08-30T10:07:00.000Z")).toBeTruthy();
    expect(screen.getByText("Participant state from locally reconciled history · stale · 2026-08-30T10:07:00.000Z")).toBeTruthy();
  });

  it("renders mixed live and retained participant rows with their own source metadata", async () => {
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
          observation: {
            freshness: "live",
            source: "cloudshare_v4_sales_participant_roster",
            observedAt: "2026-08-30T10:09:00.000Z",
          },
          participants: [
            {
              id: "enrollment-1",
              subject: { type: "sales_trial_enrollment", id: "enrollment-1" },
              firstName: "Ari",
              lastName: "Visitor",
              email: "visitor@example.test",
              participationStatus: "inProgress",
              observation: {
                freshness: "live",
                source: "cloudshare_v4_sales_participant_roster",
                observedAt: "2026-08-30T10:09:00.000Z",
              },
              firstJoined: "2026-08-30T10:05:00.000Z",
              envStatus: "Ready",
              environment: {
                dimension: "cloudshare_environment",
                value: "Ready",
                source: "cloudshare_v4_sales_participant_roster",
                observedAt: "2026-08-30T10:09:00.000Z",
              },
            },
            {
              id: "enrollment-2",
              subject: { type: "sales_trial_enrollment", id: "enrollment-2" },
              firstName: "Bea",
              lastName: "Retained",
              email: "second@example.test",
              participationStatus: "concluded",
              observation: {
                freshness: "stale",
                source: "certalis_sales_trial_enrollment_reconciliation",
                observedAt: "2026-08-30T10:07:00.000Z",
              },
              firstJoined: "2026-08-30T10:01:00.000Z",
              envStatus: "Suspended",
              environment: {
                dimension: "cloudshare_environment",
                value: "Suspended",
                source: "certalis_sales_trial_enrollment_reconciliation",
                observedAt: "2026-08-30T10:07:00.000Z",
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
    expect(screen.getByText("Observed from CloudShare participant roster · 2026-08-30T10:09:00.000Z")).toBeTruthy();
    expect(screen.getByText("Participant state from CloudShare participant roster · live · 2026-08-30T10:09:00.000Z")).toBeTruthy();
    expect(screen.getByText("Participant state from locally reconciled history · stale · 2026-08-30T10:07:00.000Z")).toBeTruthy();
  });

  it("shows monitoring controls for an unpublished offering so retained history stays reachable after unpublish", async () => {
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
              status: "unpublished",
              attentionReason: null,
            },
          ],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/participants") {
        return json({
          offering: { id: "offering-1", status: "unpublished" },
          observation: {
            freshness: "stale",
            source: "certalis_sales_trial_enrollment_reconciliation",
            observedAt: "2026-08-30T10:07:00.000Z",
            warning: "CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.",
          },
          participants: [],
          correlationId: "corr-unpublished-1",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Open monitoring" }));

    expect(await screen.findByText("CloudShare could not refresh the participant roster; showing the last locally reconciled participant state.")).toBeTruthy();
    expect(screen.queryByText("Sales Trial Offering was not found")).toBeNull();
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
    expect(end.style.background).toBe("rgb(241, 245, 249)");

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

  it("opens support diagnostics from the canonical end-trial warning without duplicating the message", async () => {
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
        return json(
          {
            error: "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
            correlationId: "corr-end-1",
            needsAttention: true,
            offering: {
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
              attentionReason: "CloudShare could not end the Sales Trial Offering. It remains published; review support diagnostics.",
            },
          },
          { status: 502 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onNavigate = vi.fn();

    render(
      <SalesTrialOfferingsAdmin
        email="sales-admin@certalis.demo"
        fetchAdmin={fetchAdmin as typeof fetch}
        onNavigate={onNavigate}
      />,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "End trial" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain("CloudShare could not end the Sales Trial Offering.");
    expect(screen.getAllByText(/CloudShare could not end the Sales Trial Offering\./)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Open support diagnostics (corr-end-1)" }));
    expect(onNavigate).toHaveBeenCalledWith({ tab: "support", correlationId: "corr-end-1" });
    expect(confirmSpy).toHaveBeenCalled();
  });

  it("disables publication while the provider request is unresolved and sends only one POST", async () => {
    let resolvePublish!: (response: Response) => void;
    const publishResponse = new Promise<Response>((resolve) => {
      resolvePublish = resolve;
    });
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales/items") return json({ activeItems: [] });
      if (url === "/api/sales/timezones") return json({ timezones: [] });
      if (url === "/api/sales/trial-offerings") {
        return json({
          offerings: [{
            id: "offering-1",
            title: "Extension QA",
            description: "Disposable trial",
            itemId: "item-1",
            start: "2026-09-03T10:00",
            end: null,
            timeZone: "UTC",
            salesProEmail: "owner@example.test",
            salesProDisplayName: "Owner",
            status: "draft",
            attentionReason: null,
          }],
        });
      }
      if (url === "/api/sales/trial-offerings/offering-1/publish" && init?.method === "POST") {
        return publishResponse;
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const user = userEvent.setup();
    const publish = await screen.findByRole("button", { name: "Publish" });
    await user.click(publish);

    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(publish.textContent).toBe("Publishing…");
    fireEvent.click(publish);
    expect(fetchAdmin.mock.calls.filter(([input, init]) =>
      String(input).endsWith("/publish") && (init as RequestInit | undefined)?.method === "POST",
    )).toHaveLength(1);

    resolvePublish(json({
      error: "CloudShare publication outcome is unknown. Do not retry.",
      correlationId: "corr-publish-1",
      offering: {
        id: "offering-1",
        title: "Extension QA",
        description: "Disposable trial",
        itemId: "item-1",
        start: "2026-09-03T10:00",
        end: null,
        timeZone: "UTC",
        salesProEmail: "owner@example.test",
        salesProDisplayName: "Owner",
        status: "needs_attention",
        attentionReason: "CloudShare publication outcome is unknown. Do not retry.",
      },
    }, { status: 502 }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "CloudShare publication outcome is unknown. Do not retry.",
    );
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

  it("keeps all four Trial window controls aligned in one desktop row with No end date inside End", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sales/items") return json({ activeItems: [] });
      if (url === "/api/sales/timezones") return json({ timezones: [] });
      if (url === "/api/sales/trial-offerings") return json({ offerings: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);

    const settings = await screen.findByLabelText("Trial window settings");
    expect(settings.getAttribute("style")).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(screen.getByLabelText("No end date").closest("label")?.parentElement?.textContent).toContain("End");
    const controls = ["Start", "End", "Time zone", "Sales Pro"].map((name) => screen.getByLabelText(name).closest("label"));
    expect(controls.every((control) => control?.getAttribute("style")?.includes("align-content: start"))).toBe(true);
  });

  it("silently yields to the shared logout redirect when End trial observes an expired admin session", async () => {
    const fetchAdmin = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sales/items") return json({ activeItems: [] });
      if (url === "/api/sales/timezones") return json({ timezones: [] });
      if (url === "/api/sales/trial-offerings") return json({ offerings: [{
        id: "offering-1", title: "Helios Trial", description: "Shared trial", itemId: "item-1",
        start: "2026-08-30T09:00", end: null, timeZone: "UTC", salesProEmail: "owner@example.test",
        salesProDisplayName: "Owner", status: "published", attentionReason: null,
      }] });
      if (url === "/api/sales/trial-offerings/offering-1/end" && init?.method === "POST") throw new AdminSessionExpiredError();
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SalesTrialOfferingsAdmin email="sales-admin@certalis.demo" fetchAdmin={fetchAdmin as typeof fetch} />);
    const user = userEvent.setup();

    await expect(user.click(await screen.findByRole("button", { name: "End trial" }))).resolves.toBeUndefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
