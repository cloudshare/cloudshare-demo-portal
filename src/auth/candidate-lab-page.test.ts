import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidateLabPage from "../../app/candidate/lab/page";

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
  getPortalHomePath: (session: { role: string }) =>
    session.role === "sales_trial_participant" ? "/sales-trial" : "/admin",
}));

vi.mock("@/web/candidate-lab-shell", () => ({
  CandidateLabShell: ({
    email,
    examAttemptId,
    initialAttemptStatus,
  }: {
    email: string;
    examAttemptId: string;
    initialAttemptStatus: string;
  }) => ({
    type: "CandidateLabShell",
    props: { email, examAttemptId, initialAttemptStatus },
  }),
}));

describe("candidate lab page", () => {
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

  it("redirects anonymous users to /login", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(CandidateLabPage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
        attemptStatus: "ready",
      }),
    })).rejects.toThrow("redirect:/login?returnTo=%2Fcandidate");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnTo=%2Fcandidate");
  });

  it("redirects admins away from candidate lab screens", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    await expect(CandidateLabPage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
        attemptStatus: "ready",
      }),
    })).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("renders the lab shell with candidate navigation controls", async () => {
    const page = await CandidateLabPage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
        attemptStatus: "in_progress",
      }),
    });

    expect(page).toMatchObject({
      props: {
        email: "candidate@helioscx.demo",
        examAttemptId: "ea-1",
        initialAttemptStatus: "in_progress",
      },
    });
  });

  it("renders the protected fallback when no exam attempt id is present", async () => {
    const page = await CandidateLabPage({ searchParams: Promise.resolve({}) });

    expect(page).toMatchObject({
      type: expect.any(Function),
      props: {
        title: "Launch lab",
        message: "Missing examAttemptId.",
      },
    });
  });

  it("defaults unknown attempt statuses to ready", async () => {
    const page = await CandidateLabPage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
        attemptStatus: "unknown",
      }),
    });

    expect(page).toMatchObject({
      props: {
        initialAttemptStatus: "ready",
      },
    });
  });
});
