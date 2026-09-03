import { describe, expect, it, vi } from "vitest";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";

describe("portal session-expiry redirect", () => {
  it("replaces a safe current target exactly once when concurrent 401 responses arrive", () => {
    const replace = vi.fn();
    const redirect = createPortalSessionExpiryRedirect({
      currentPath: () => "/sales?tab=sessions&queueView=active",
      fallbackLoginPath: "/login",
      replace,
    });

    redirect();
    redirect();

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/login?returnTo=%2Fsales%3Ftab%3Dsessions%26queueView%3Dactive");
  });

  it("falls back without carrying an unsafe or failed-request target", () => {
    const replace = vi.fn();
    const redirect = createPortalSessionExpiryRedirect({
      currentPath: () => "/api/sales/enablement-sessions?accessLink=secret",
      fallbackLoginPath: "/login",
      replace,
    });

    redirect();

    expect(replace).toHaveBeenCalledWith("/login");
  });
});
