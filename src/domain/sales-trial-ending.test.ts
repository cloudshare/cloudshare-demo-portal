import { describe, expect, it } from "vitest";
import { calculateSalesTrialEnding } from "./sales-trial-ending";

describe("Sales Trial deferred ending", () => {
  it("retains Trial date-only expiry acceptance and rejects invalid active expiry", () => {
    expect(calculateSalesTrialEnding({ observations: [
      { state: "preparing", expiry: { raw: "2026-09-01", session: null, trial: new Date("2026-09-01") } },
      { state: "creation_failed", expiry: { raw: "bad", session: null, trial: null } },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC" })).toMatchObject({ activeCount: 1, calculatedEnd: "2026-09-01T00:05" });
    expect(() => calculateSalesTrialEnding({ observations: [
      { state: "taking_snapshot", expiry: { raw: "bad", session: null, trial: null } },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC" })).toThrow("CloudShare returned an invalid Environment expirationTime.");
  });
  it("keeps Archived active and rounds latest expiry plus five minutes upward", () => {
    expect(calculateSalesTrialEnding({ observations: [
      { state: "ready", expiry: { raw: "Tue, 01 Sep 2026 13:00:00 GMT", session: null, trial: new Date("Tue, 01 Sep 2026 13:00:00 GMT") } },
      { state: "archived", expiry: { raw: "Tue, 01 Sep 2026 14:30:59 GMT", session: null, trial: new Date("Tue, 01 Sep 2026 14:30:59 GMT") } },
      { state: "deleted", expiry: { raw: "Tue, 01 Sep 2026 20:00:00 GMT", session: null, trial: new Date("Tue, 01 Sep 2026 20:00:00 GMT") } },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC" })).toMatchObject({
      activeCount: 2, calculatedEnd: "2026-09-01T14:36", shouldUpdate: true,
    });
  });

  it("uses a two-minute grace when every Environment is terminal", () => {
    expect(calculateSalesTrialEnding({ observations: [
      { state: "deleted", expiry: { raw: "Tue, 01 Sep 2026 13:00:00 GMT", session: null, trial: new Date("Tue, 01 Sep 2026 13:00:00 GMT") } },
      { state: "creation_failed", expiry: { raw: "Tue, 01 Sep 2026 14:00:00 GMT", session: null, trial: new Date("Tue, 01 Sep 2026 14:00:00 GMT") } },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC" })).toMatchObject({
      activeCount: 0, calculatedEnd: "2026-08-31T12:02", shouldUpdate: true,
    });
  });

  it("sets a two-minute terminal target once even when the provider end was later, then does not perpetually extend it", () => {
    expect(calculateSalesTrialEnding({ observations: [], now: new Date("2026-08-31T12:00:00Z"),
      timeZone: "UTC", providerEnd: "2026-09-02T12:00:00" })).toMatchObject({
      activeCount: 0, effectiveEnd: "2026-08-31T12:02", shouldUpdate: true,
    });
    expect(calculateSalesTrialEnding({ observations: [], now: new Date("2026-08-31T12:05:00Z"),
      timeZone: "UTC", providerEnd: "2026-08-31T12:02:00", persistedTerminalTarget: "2026-08-31T12:02" })).toMatchObject({
      activeCount: 0, effectiveEnd: "2026-08-31T12:02", shouldUpdate: false,
    });
  });

  it("never moves an active Experience end earlier", () => {
    expect(calculateSalesTrialEnding({ observations: [
      { state: "suspended", expiry: { raw: "Tue, 01 Sep 2026 13:00:00 GMT", session: null, trial: new Date("Tue, 01 Sep 2026 13:00:00 GMT") } },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC", providerEnd: "2026-09-02T12:00:00" })).toMatchObject({
      calculatedEnd: "2026-09-01T13:05", effectiveEnd: "2026-09-02T12:00", shouldUpdate: false,
    });
  });
});
