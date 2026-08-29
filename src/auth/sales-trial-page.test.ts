import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesTrialPage from "../../app/sales-trial/page";

const { mockCookies, mockRedirect, mockGetServices, mockGetPortalSession } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/composition", () => ({
  getPortalSessionServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
  getPortalHomePath: (session: { role: "admin" | "candidate" | "sales_trial_participant"; workspace?: "certification" | "sales" | "both" } | null) =>
    session?.role === "admin"
      ? session.workspace === "sales"
        ? "/sales"
        : "/admin"
      : session?.role === "candidate"
        ? "/candidate"
        : "/sales-trial",
}));

describe("sales trial page routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({});
  });

  it("redirects anonymous or expired sessions to Sales Trial registration", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(SalesTrialPage()).rejects.toThrow("redirect:/sales-trial/register");
    expect(mockRedirect).toHaveBeenCalledWith("/sales-trial/register");
  });

  it("renders the Sales Trial participant home", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      userId: "trial-user-1",
      email: "visitor@example.test",
      firstName: "Ari",
      lastName: "Visitor",
      role: "sales_trial_participant",
      workspace: "sales",
    });

    const page = await SalesTrialPage();

    expect(page).toMatchObject({
      props: {
        email: "visitor@example.test",
        firstName: "Ari",
      },
    });
  });

  it("redirects a non-Sales Trial session back to its own home", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      userId: "candidate-1",
      email: "candidate@helioscx.demo",
      role: "candidate",
      workspace: "certification",
    });

    await expect(SalesTrialPage()).rejects.toThrow("redirect:/candidate");
    expect(mockRedirect).toHaveBeenCalledWith("/candidate");
  });
});
