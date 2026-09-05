import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SalesTrialPage from "../../app/sales-trial/page";
import SalesTrialRegisterPage from "../../app/sales-trial/register/page";

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
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
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

  it("redirects an expired Sales Trial navigation to its safe login return target", async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    mockGetPortalSession.mockResolvedValue(null);

    await expect(SalesTrialPage()).rejects.toThrow("redirect:/sales-trial/login?returnTo=%2Fsales-trial");
    expect(mockRedirect).toHaveBeenCalledWith("/sales-trial/login?returnTo=%2Fsales-trial");
  });

  it("does not leave an expired Sales Trial page to display stale protected UI", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(SalesTrialPage()).rejects.toThrow("redirect:/sales-trial/login?returnTo=%2Fsales-trial");
    expect(mockRedirect).toHaveBeenCalledWith("/sales-trial/login?returnTo=%2Fsales-trial");
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

    const html = renderToStaticMarkup(page);
    expect(html).toContain("Welcome, Ari.");
    expect(html).toContain("There are no active Trial Offerings right now.");
    expect(html).not.toContain("Exam catalog");
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

describe("sales trial registration page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => undefined });
    mockGetServices.mockReturnValue({});
    mockGetPortalSession.mockResolvedValue(null);
  });

  it("renders a safe native-form registration failure", async () => {
    const renderRegisterPage = SalesTrialRegisterPage as unknown as (props: {
      searchParams: Promise<Record<string, string>>;
    }) => Promise<ReactElement>;

    const page = await renderRegisterPage({
      searchParams: Promise.resolve({ error: "Registration is unavailable." }),
    });

    expect(renderToStaticMarkup(page)).toContain("Registration is unavailable.");
  });
});
