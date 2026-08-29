import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidatePage from "../../app/candidate/page";

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
    session.role === "sales_trial_participant" ? "/sales-trial" : "/admin",
}));

describe("Candidate page routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-trial" }) });
    mockGetServices.mockReturnValue({});
  });

  it("returns Sales Trial participants to their own home", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "session-trial",
      userId: "trial-user",
      customerId: "customer-certalis",
      email: "visitor@example.test",
      role: "sales_trial_participant",
      workspace: "sales",
    });

    await expect(CandidatePage()).rejects.toThrow("redirect:/sales-trial");
    expect(mockRedirect).toHaveBeenCalledWith("/sales-trial");
  });
});
