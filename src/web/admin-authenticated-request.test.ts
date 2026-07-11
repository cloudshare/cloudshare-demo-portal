import { describe, expect, it, vi } from "vitest";
import {
  AdminSessionExpiredError,
  createAdminAuthenticatedRequest,
} from "./admin-authenticated-request";

describe("admin authenticated requests", () => {
  it("returns successful responses without changing their request behavior", async () => {
    const response = new Response(JSON.stringify({ hasConnection: true }), { status: 200 });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const onSessionExpired = vi.fn();
    const request = createAdminAuthenticatedRequest({ fetchImpl, onSessionExpired });

    await expect(request("/api/admin/cloudshare")).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith("/api/admin/cloudshare", undefined);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("preserves the admin session-expiry outcome for API 401 responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const onSessionExpired = vi.fn();
    const request = createAdminAuthenticatedRequest({ fetchImpl, onSessionExpired });

    await expect(request("/api/admin/exams")).rejects.toBeInstanceOf(AdminSessionExpiredError);
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });
});
