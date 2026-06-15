import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "../../app/page";

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
  getServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
  getPortalHomePath: (session: { role: "admin" | "candidate" } | null) =>
    session?.role === "admin" ? "/admin" : session?.role === "candidate" ? "/candidate" : "/login",
}));

describe("home page routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({});
  });

  it("redirects anonymous users to /login", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(Home()).rejects.toThrow("redirect:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects admins to /admin", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    await expect(Home()).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("redirects Candidates to /candidate", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "candidate@helioscx.demo",
      role: "candidate",
    });

    await expect(Home()).rejects.toThrow("redirect:/candidate");
    expect(mockRedirect).toHaveBeenCalledWith("/candidate");
  });
});
