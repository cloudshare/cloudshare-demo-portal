import { describe, expect, it, vi } from "vitest";
import { handleUpdateSalesSession } from "./sales-session-edit";

const session = { id: "s1", cloudShareSalesExperienceId: "remote-1", start: "2026-08-15T09:00", timeZone: "UTC", operationalStatus: "active" };
const actor = { type: "admin", id: "a", email: "a@certalis.demo" };
describe("controlled Sales Session edit", () => {
  it("allows only an upcoming session and records the full-PUT exchange", async () => {
    const updateSession = vi.fn().mockResolvedValue({ id: "remote-1", request: { method: "PUT", path: "/sales/remote-1", body: { projectId: "project-1" } }, response: { status: 200, body: {} } }); const diagnostics = { record: vi.fn() }; const audit = { write: vi.fn() };
    const updateDisplayName = vi.fn(); const result = await handleUpdateSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(session), updateDisplayName }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, timezones: { find: vi.fn().mockResolvedValue({ timezones: [{ id: "UTC", name: "UTC" }] }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), updateSession }) }, diagnostics, audit, now: () => new Date("2026-08-01T00:00:00Z") }, { customerId: "certalis", sessionId: "s1", actor, body: { name: "Renamed Session" } });
    expect(result).toMatchObject({ status: 200, body: { correlationId: expect.any(String) } }); expect(updateSession).toHaveBeenCalledWith("remote-1", { name: "Renamed Session" }); expect(updateDisplayName).toHaveBeenCalledWith("s1", "Renamed Session"); expect(diagnostics.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success", request: expect.objectContaining({ method: "PUT" }) })); expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ outcome: "success" }));
  });
  it("denies ended or needs-attention sessions before contacting CloudShare", async () => {
    const updateSession = vi.fn(); const result = await handleUpdateSalesSession({ sessions: { findById: vi.fn().mockResolvedValue({ ...session, operationalStatus: "needs_attention" }) }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, timezones: { find: vi.fn() }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), updateSession }) } }, { customerId: "certalis", sessionId: "s1", actor, body: { name: "Renamed Session" } });
    expect(result.status).toBe(409); expect(updateSession).not.toHaveBeenCalled();
  });
  it("marks the persisted session needs-attention when the local display name cannot be saved", async () => {
    const updateOperationalState = vi.fn(); const result = await handleUpdateSalesSession({ sessions: { findById: vi.fn().mockResolvedValue(session), updateDisplayName: vi.fn().mockRejectedValue(new Error("db unavailable")), updateOperationalState }, connections: { findByCustomerId: vi.fn().mockResolvedValue({ customerId: "certalis" }) }, timezones: { find: vi.fn().mockResolvedValue({ timezones: [{ id: "UTC", name: "UTC" }] }) }, deliveryFactory: { forConnection: () => ({ createSession: vi.fn(), readSession: vi.fn(), updateSession: vi.fn().mockResolvedValue({ id: "remote-1", request: { method: "PUT" }, response: { status: 200 } }) }) }, now: () => new Date("2026-08-01T00:00:00Z") }, { customerId: "certalis", sessionId: "s1", actor, body: { name: "Renamed Session" } });
    expect(result).toMatchObject({ status: 503, body: { needsAttention: true, correlationId: expect.any(String) } }); expect(updateOperationalState).toHaveBeenCalledWith("s1", expect.objectContaining({ operationalStatus: "needs_attention" }));
  });
});
