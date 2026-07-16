import { describe, expect, it, vi } from "vitest";
import { handleUpdateSalesSession } from "./sales-session-edit";

describe("controlled Sales Session edit", () => {
  it("defers valid name edits before constructing any CloudShare delivery", async () => {
    const forConnection = vi.fn();
    const result = await handleUpdateSalesSession({ deliveryFactory: { forConnection } }, { customerId: "certalis", sessionId: "s1", actor: { type: "admin" }, body: { name: "Renamed Session" } });

    expect(result).toMatchObject({ status: 409, body: { error: expect.stringContaining("deferred") } });
    expect(forConnection).not.toHaveBeenCalled();
  });

  it("still rejects a malformed or out-of-scope edit payload", async () => {
    const result = await handleUpdateSalesSession({}, { customerId: "certalis", sessionId: "s1", actor: { type: "admin" }, body: { start: "2026-08-16T09:00" } });

    expect(result).toMatchObject({ status: 400 });
  });
});
