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
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) }; const audit = { write: vi.fn().mockResolvedValue(undefined) };
    const offline = Object.assign(new Error("offline"), { context: { method: "GET", path: "/timezones", responseStatus: 503 } });
    const result = await handleGetSalesTimezones({ cache, preferences, diagnostics, audit, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, timezoneSourceFactory: { forConnection: () => ({ list: vi.fn().mockRejectedValue(offline) }) }, now: () => new Date("2026-07-15T10:00:00Z") }, { customerId: "certalis", userId: "admin", actor: { type: "admin", id: "admin", email: "admin@certalis.demo" } });
    expect(result).toMatchObject({ status: 200, body: { freshness: "stale", warning: expect.any(String), correlationId: expect.any(String) } });
    expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ correlationId: expect.any(String), request: expect.objectContaining({ path: "/timezones" }), response: expect.objectContaining({ status: 503 }), details: expect.objectContaining({ integrationSurface: "cloudshare.v3.timezones" }) }));
    await expect(handleSaveSalesPreference({ cache, preferences, connections: { findByCustomerId: vi.fn() } }, { customerId: "certalis", userId: "admin", body: { timeZone: "UTC", experienceType: "poc" } })).resolves.toMatchObject({ status: 204 });
    expect(preferences.save).toHaveBeenCalledWith("admin", { timeZone: "UTC", experienceType: "poc" });
  });
});
