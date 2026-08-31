import { describe, expect, it } from "vitest";
import { calculateSalesTrialEnding } from "./sales-trial-ending";

describe("Sales Trial deferred ending", () => {
  it("keeps Archived active and rounds latest expiry plus five minutes upward", () => {
    expect(calculateSalesTrialEnding({ observations: [
      { statusCode: 2, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" },
      { statusCode: 4, expirationTime: "Tue, 01 Sep 2026 14:30:59 GMT" },
      { statusCode: 5, expirationTime: "Tue, 01 Sep 2026 20:00:00 GMT" },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC" })).toMatchObject({
      activeCount: 2, calculatedEnd: "2026-09-01T14:36", shouldUpdate: true,
    });
  });

  it("uses a two-minute grace when every Environment is terminal", () => {
    expect(calculateSalesTrialEnding({ observations: [
      { statusCode: 5, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" },
      { statusCode: 9, expirationTime: "Tue, 01 Sep 2026 14:00:00 GMT" },
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
      { statusCode: 3, expirationTime: "Tue, 01 Sep 2026 13:00:00 GMT" },
    ], now: new Date("2026-08-31T12:00:00Z"), timeZone: "UTC", providerEnd: "2026-09-02T12:00:00" })).toMatchObject({
      calculatedEnd: "2026-09-01T13:05", effectiveEnd: "2026-09-02T12:00", shouldUpdate: false,
    });
  });
});
