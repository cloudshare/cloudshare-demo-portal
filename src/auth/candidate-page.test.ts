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

vi.mock("@/web/candidate-home", () => ({
  CandidateHome: ({ email, initialRoute }: { email: string; initialRoute: unknown }) => ({
    type: "CandidateHome",
    props: { email, initialRoute },
  }),
}));

describe("Candidate page routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ get: () => ({ value: "session-trial" }) });
    mockGetServices.mockReturnValue({});
  });

  it("redirects an expired Candidate navigation to its safe login return target", async () => {
    mockGetPortalSession.mockResolvedValue(null);

    await expect(CandidatePage({})).rejects.toThrow("redirect:/login?returnTo=%2Fcandidate");
    expect(mockRedirect).toHaveBeenCalledWith("/login?returnTo=%2Fcandidate");
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

    await expect(CandidatePage({})).rejects.toThrow("redirect:/sales-trial");
    expect(mockRedirect).toHaveBeenCalledWith("/sales-trial");
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

  it("passes the requested candidate task route into the shell", async () => {
    mockGetPortalSession.mockResolvedValue({ sessionId: "session-trial", customerId: "customer-certalis", email: "candidate@helioscx.demo", role: "candidate" });
    const page = await CandidatePage({ searchParams: Promise.resolve({ task: "history", attemptId: "attempt-1", examId: "exam-2" }) });
    expect(page).toMatchObject({ props: { email: "candidate@helioscx.demo", initialRoute: { task: "history", attemptId: "attempt-1", examId: "exam-2" } } });
  });

  it.each([
    ["current", "attempt-1", "exam-1"],
    ["schedule", undefined, "exam-2"],
    ["history", "attempt-2", "exam-2"],
  ] as const)("composes CandidatePage with the %s route identifiers intact", async (task, attemptId, examId) => {
    mockGetPortalSession.mockResolvedValue({ sessionId: "session-trial", customerId: "customer-certalis", email: "candidate@helioscx.demo", role: "candidate" });
    const page = await CandidatePage({ searchParams: Promise.resolve({ task, attemptId, examId }) });
    expect(page).toMatchObject({ props: { initialRoute: { task, attemptId: attemptId ?? null, examId } } });
  });

  it("fails closed for duplicate and array identifiers at the composed page boundary", async () => {
    for (const searchParams of [{ task: ["current", "history"] }, { attemptId: ["a", "b"] }, { examId: ["e", "f"] }]) {
      mockGetPortalSession.mockResolvedValue(null);
      await expect(CandidatePage({ searchParams: Promise.resolve(searchParams) })).rejects.toThrow("redirect:/login");
      expect(mockRedirect).toHaveBeenLastCalledWith("/login?returnTo=%2Fcandidate");
    }
  });
});
