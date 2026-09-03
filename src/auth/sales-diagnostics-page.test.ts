import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesDiagnosticsPage from "../../app/sales/diagnostics/page";

const { mockCookies, mockRedirect, mockGetServices, mockGetPortalSession } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/composition", () => ({ getPortalSessionServices: mockGetServices }));
vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
  getPortalHomePath: (session: { role: string }) =>
    session.role === "sales_trial_participant" ? "/sales-trial" : "/candidate",
}));

describe("Sales diagnostics page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-certalis" }) });
    mockGetServices.mockReturnValue({});
  });

  it("forwards the legacy diagnostics route to Sales Support for a sales-configured Customer admin", async () => {
    mockGetPortalSession.mockResolvedValue({ role: "admin", workspace: "sales", email: "sales-admin@certalis.demo" });

    await expect(SalesDiagnosticsPage()).rejects.toThrow("redirect:/sales?tab=support");
    expect(mockRedirect).toHaveBeenCalledWith("/sales?tab=support");
  });

  it("redirects an expired direct Sales diagnostics navigation through the Sales login contract", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(SalesDiagnosticsPage()).rejects.toThrow("redirect:/login?returnTo=%2Fsales%3Ftab%3Dsupport");
  });

  it("redirects a certification workspace admin away from Sales diagnostics", async () => {
    mockGetPortalSession.mockResolvedValue({ role: "admin", workspace: "certification", email: "admin@helioscx.demo" });

    await expect(SalesDiagnosticsPage()).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });
});
