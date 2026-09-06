import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidatePage from "../../app/candidate/page";

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
  getPortalHomePath: (session: { role: string }) => session.role === "candidate" ? "/candidate" : "/admin",
}));

vi.mock("@/web/candidate-home", () => ({
  CandidateHome: ({
    email,
    initialRoute,
  }: {
    email: string;
    initialRoute: { task: string | null; attemptId: string | null; examId: string | null };
  }) => ({
    type: "CandidateHome",
    props: { email, initialRoute },
  }),
}));

describe("candidate page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetServices.mockReturnValue({});
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "candidate@helioscx.demo",
      role: "candidate",
    });
  });

  it("redirects anonymous users to /login with a safe candidate return target", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(CandidatePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnTo=%2Fcandidate");
  });

  it("fails closed for duplicate or array route parameters", async () => {
    mockGetPortalSession.mockResolvedValue(null);
    await expect(CandidatePage({ searchParams: Promise.resolve({ task: ["current", "history"] }) })).rejects.toThrow("redirect:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnTo=%2Fcandidate");
  });

  it("redirects admins away from candidate delivery", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    await expect(CandidatePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("passes the requested candidate task route into the shell", async () => {
    const page = await CandidatePage({
      searchParams: Promise.resolve({
        task: "history",
        attemptId: "attempt-1",
        examId: "exam-2",
      }),
    });

    expect(page).toMatchObject({
      props: {
        email: "candidate@helioscx.demo",
        initialRoute: {
          task: "history",
          attemptId: "attempt-1",
          examId: "exam-2",
        },
      },
    });
  });
});
