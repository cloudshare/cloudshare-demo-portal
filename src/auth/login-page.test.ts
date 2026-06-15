import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../../app/login/page";

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
    session?.role === "admin" ? "/admin" : "/candidate",
}));

vi.mock("../../app/login/login-form", () => ({
  LoginForm: ({ initialError, initialEmail }: { initialError: string | null; initialEmail: string }) => ({
    type: "LoginForm",
    props: { initialError, initialEmail },
  }),
}));

describe("login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({
      config: {
        seed: {
          heliosAdmin: { email: "admin@helioscx.demo", password: "secret" },
        },
      },
    });
  });

  it("redirects authenticated admins away from /login", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    await expect(LoginPage({})).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("redirects authenticated Candidates away from /login", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "candidate@helioscx.demo",
      role: "candidate",
    });

    await expect(LoginPage({})).rejects.toThrow("redirect:/candidate");
    expect(mockRedirect).toHaveBeenCalledWith("/candidate");
  });

  it("renders the login form for anonymous users", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    const page = await LoginPage({});

    expect(page).toMatchObject({
      props: { initialError: null, initialEmail: "admin@helioscx.demo" },
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
