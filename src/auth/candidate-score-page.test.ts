import { beforeEach, describe, expect, it, vi } from "vitest";
import CandidateScorePage from "../../app/candidate/score/page";

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
}));

vi.mock("@/web/score-display", () => ({
  ScoreDisplay: ({ examAttemptId, email }: { examAttemptId: string; email: string }) => ({
    type: "ScoreDisplay",
    props: { examAttemptId, email },
  }),
}));

describe("candidate score page", () => {
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

    await expect(CandidateScorePage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
      }),
    })).rejects.toThrow("redirect:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("redirects admins away from candidate score screens", async () => {
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      customerId: "customer-helios",
      email: "admin@helioscx.demo",
      role: "admin",
    });

    await expect(CandidateScorePage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
      }),
    })).rejects.toThrow("redirect:/admin");
    expect(mockRedirect).toHaveBeenCalledWith("/admin");
  });

  it("renders the score display for the signed-in Candidate", async () => {
    const page = await CandidateScorePage({
      searchParams: Promise.resolve({
        examAttemptId: "ea-1",
      }),
    });

    expect(page).toMatchObject({ type: "main" });
    expect(page.props.children).toMatchObject({
      type: expect.any(Function),
      props: {
        examAttemptId: "ea-1",
        email: "candidate@helioscx.demo",
      },
    });
  });

  it("renders the missing-attempt message when no exam attempt id is present", async () => {
    const page = await CandidateScorePage({
      searchParams: Promise.resolve({}),
    });

    expect(page).toMatchObject({
      type: "main",
      props: {
        children: [
          expect.objectContaining({
            type: expect.any(Function),
            props: expect.objectContaining({
              title: "Session complete",
              email: "candidate@helioscx.demo",
            }),
          }),
          expect.objectContaining({
            type: "p",
            props: expect.objectContaining({
              children: "Missing examAttemptId.",
            }),
          }),
        ],
      },
    });
  });
});
