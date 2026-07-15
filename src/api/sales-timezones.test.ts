import { describe, expect, it, vi } from "vitest";
import { handleGetSalesTimezones, handleSaveSalesPreference } from "./sales-timezones";

describe("Sales timezone API", () => {
  const preferences = { find: vi.fn().mockResolvedValue({ timeZone: "UTC", experienceType: "demo" }), save: vi.fn() };
  it("returns a deliberately fresh cached catalogue without a live call", async () => {
    const result = await handleGetSalesTimezones({ cache: { find: vi.fn().mockResolvedValue({ customerId: "certalis", timezones: [{ id: "UTC", name: "UTC" }], fetchedAt: new Date("2026-07-15T09:00:00Z") }), save: vi.fn() }, preferences, connections: { findByCustomerId: vi.fn() }, now: () => new Date("2026-07-15T10:00:00Z") }, { customerId: "certalis", userId: "admin" });
    expect(result).toMatchObject({ status: 200, body: { freshness: "fresh", timezones: [{ id: "UTC" }], preference: { timeZone: "UTC" } } });
  });
  it("falls back to stale verified values when the live read fails and persists validated preferences", async () => {
    const cache = { find: vi.fn().mockResolvedValue({ customerId: "certalis", timezones: [{ id: "UTC", name: "UTC" }], fetchedAt: new Date("2026-07-13T09:00:00Z") }), save: vi.fn() };
    const result = await handleGetSalesTimezones({ cache, preferences, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, timezoneSourceFactory: { forConnection: () => ({ list: vi.fn().mockRejectedValue(new Error("offline")) }) }, now: () => new Date("2026-07-15T10:00:00Z") }, { customerId: "certalis", userId: "admin" });
    expect(result).toMatchObject({ status: 200, body: { freshness: "stale", warning: expect.any(String) } });
    await expect(handleSaveSalesPreference({ cache, preferences, connections: { findByCustomerId: vi.fn() } }, { userId: "admin", body: { timeZone: "UTC", experienceType: "poc" } })).resolves.toMatchObject({ status: 204 });
    expect(preferences.save).toHaveBeenCalledWith("admin", { timeZone: "UTC", experienceType: "poc" });
  });
});
