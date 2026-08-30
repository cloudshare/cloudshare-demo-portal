import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSalesTrialEnterUrl,
  clearSalesTrialWindows,
  openSalesTrialWindow,
  readSalesTrialEnterBlockedMessage,
} from "./sales-trial-window";

function fakeWindow() {
  return { closed: false, close: vi.fn(), focus: vi.fn() };
}

beforeEach(() => {
  clearSalesTrialWindows();
});

describe("Sales Trial retained child window", () => {
  it("opens a Sales Trial offering through the portal route, not a provider URL", () => {
    const opener = vi.fn(() => fakeWindow());

    openSalesTrialWindow("offering-1", opener);

    expect(opener).toHaveBeenCalledWith(
      "/sales-trial/offerings/offering-1/enter",
      "sales_trial_offering-1",
    );
  });

  it("reuses and focuses the retained child window for repeat entry", () => {
    const handle = fakeWindow();
    const opener = vi.fn(() => handle);

    const first = openSalesTrialWindow("offering-1", opener);
    const second = openSalesTrialWindow("offering-1", opener);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(handle.focus).toHaveBeenCalledTimes(1);
  });

  it("accepts same-origin blocked entry messages for the current offering only", () => {
    expect(
      readSalesTrialEnterBlockedMessage(
        {
          origin: "http://localhost:3000",
          data: {
            type: "certalis:sales-trial-entry-blocked",
            offeringId: "offering-1",
            status: 404,
            message: "This Sales Trial launch is unavailable.",
          },
        } as MessageEvent,
        {
          expectedOrigin: "http://localhost:3000",
          offeringId: "offering-1",
        },
      ),
    ).toEqual({
      status: 404,
      message: "This Sales Trial launch is unavailable.",
    });
  });

  it("ignores blocked entry messages from another origin or offering", () => {
    const payload = {
      type: "certalis:sales-trial-entry-blocked",
      offeringId: "offering-1",
      status: 404,
      message: "Blocked.",
    };

    expect(
      readSalesTrialEnterBlockedMessage(
        { origin: "https://evil.example", data: payload } as MessageEvent,
        { expectedOrigin: "http://localhost:3000", offeringId: "offering-1" },
      ),
    ).toBeNull();
    expect(
      readSalesTrialEnterBlockedMessage(
        { origin: "http://localhost:3000", data: payload } as MessageEvent,
        { expectedOrigin: "http://localhost:3000", offeringId: "offering-2" },
      ),
    ).toBeNull();
  });

  it("builds a stable portal entry URL", () => {
    expect(buildSalesTrialEnterUrl("offering-1")).toBe("/sales-trial/offerings/offering-1/enter");
  });
});
