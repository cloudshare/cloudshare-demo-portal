import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesTrialOfferingsPage from "../../app/sales/trial-offerings/page";

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

describe("Sales Trial Offerings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-certalis" }) });
    mockGetServices.mockReturnValue({});
  });

  it("renders inside the Sales workspace shell for a sales-configured Customer admin", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "session-certalis", userId: "admin-certalis", customerId: "customer-certalis",
      email: "sales-admin@certalis.demo", role: "admin", workspace: "sales",
    });

    const page = await SalesTrialOfferingsPage();

    expect(page).toMatchObject({
      props: {
        email: "sales-admin@certalis.demo",
        initialRoute: { tab: "trial-offerings" },
      },
    });
  });

  it("redirects an expired direct Trial Offerings navigation through the Sales login contract", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(SalesTrialOfferingsPage()).rejects.toThrow("redirect:/login?returnTo=%2Fsales%3Ftab%3Dtrial-offerings");
  });
});
