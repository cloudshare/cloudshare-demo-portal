import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesPage from "../../app/sales/page";

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

describe("Sales workspace page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-certalis" }) });
    mockGetServices.mockReturnValue({});
  });

  it("renders the empty Sales workspace for a sales-configured Customer admin", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "session-certalis", userId: "admin-certalis", customerId: "customer-certalis",
      email: "sales-admin@certalis.demo", role: "admin", workspace: "sales",
    });

    const page = await SalesPage({});

    expect(page).toMatchObject({ props: { email: "sales-admin@certalis.demo" } });
  });

  it("passes the Sales URL hierarchy into the client workspace for reload restoration", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "session-certalis", userId: "admin-certalis", customerId: "customer-certalis",
      email: "sales-admin@certalis.demo", role: "admin", workspace: "sales",
    });

    const page = await SalesPage({ searchParams: Promise.resolve({ accountId: "account-1", opportunityId: "opportunity-1" }) });

    expect(page).toMatchObject({ props: { initialSelection: { accountId: "account-1", opportunityId: "opportunity-1" } } });
  });

  it("does not let a Helios certification admin use the Sales workspace", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "session-helios", userId: "admin-helios", customerId: "customer-helios",
      email: "admin@helioscx.demo", role: "admin", workspace: "certification",
    });

    await expect(SalesPage({})).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });
});
