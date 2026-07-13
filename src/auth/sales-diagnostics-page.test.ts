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
vi.mock("@/auth/portal-session", () => ({ getPortalSession: mockGetPortalSession }));

describe("Sales diagnostics page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-certalis" }) });
    mockGetServices.mockReturnValue({});
  });

  it("renders the Sales-only diagnostics screen for a sales-configured Customer admin", async () => {
    mockGetPortalSession.mockResolvedValue({ role: "admin", workspace: "sales", email: "sales-admin@certalis.demo" });

    const page = await SalesDiagnosticsPage();

    expect(page).toMatchObject({ props: { email: "sales-admin@certalis.demo" } });
  });

  it("redirects a certification workspace admin away from Sales diagnostics", async () => {
    mockGetPortalSession.mockResolvedValue({ role: "admin", workspace: "certification", email: "admin@helioscx.demo" });

    await expect(SalesDiagnosticsPage()).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });
});
