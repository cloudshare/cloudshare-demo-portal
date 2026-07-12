import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminPage from "../../app/admin/page";

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
  getPortalSessionServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
}));

vi.mock("@/web/admin-console", () => ({
  AdminConsole: ({ email }: { email: string }) => ({ type: "AdminConsole", props: { email } }),
}));

describe("admin page routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({});
  });

  it("redirects anonymous users to /login", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(AdminPage({})).rejects.toThrow("redirect:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects Candidates away from admin screens", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "candidate@helioscx.demo",
      role: "candidate",
    });

    await expect(AdminPage({})).rejects.toThrow("redirect:/candidate");
    expect(mockRedirect).toHaveBeenCalledWith("/candidate");
  });

  it("renders the admin console for admins", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    const page = await AdminPage({});
    expect(page).toMatchObject({
      props: { email: "admin@helioscx.demo" },
    });
  });

  it("redirects a Sales-configured admin to the isolated Sales workspace", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-certalis",
      email: "sales-admin@certalis.demo",
      role: "admin",
      workspace: "sales",
    });

    await expect(AdminPage({})).rejects.toThrow("redirect:/sales");
    expect(mockRedirect).toHaveBeenCalledWith("/sales");
  });
});
