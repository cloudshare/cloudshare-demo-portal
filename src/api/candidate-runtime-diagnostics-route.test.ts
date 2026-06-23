import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/candidate/runtime-diagnostics/route";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalSession,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
}));

vi.mock("@/auth/portal-session", () => ({
  getPortalSession: mockGetPortalSession,
}));

describe("candidate runtime diagnostics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("records a popup-blocked warning for the candidate's own exam attempt", async () => {
    const services = {
      examAttempts: {
        findById: vi.fn().mockResolvedValue({
          id: "ea-1",
          customerId: "customer-1",
          candidateId: "candidate-owner",
          examId: "exam-1",
          status: "in_progress",
          scheduledFor: new Date("2026-06-23T08:00:00.000Z"),
          createdAt: new Date("2026-06-23T07:00:00.000Z"),
        }),
      },
      labLaunches: {
        findByExamAttemptId: vi.fn().mockResolvedValue(null),
      },
      diagnosticRecorder: {
        record: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockGetServices.mockReturnValue(services);
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      userId: "candidate-owner",
      customerId: "customer-1",
      role: "candidate",
      email: "candidate@helioscx.demo",
      issuedAtMs: 1,
    });

    const response = await POST(
      new Request("http://localhost/api/candidate/runtime-diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          examAttemptId: "ea-1",
          attemptedAction: "open",
          failureReason: "popup_blocked",
          attemptStatus: "in_progress",
          candidateMessage:
            "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry.",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(services.diagnosticRecorder.record).toHaveBeenCalledWith({
      source: "runtime",
      level: "warn",
      operation: "candidate.lab_launch.popup_blocked",
      outcome: "failure",
      customerId: "customer-1",
      candidateEmail: "candidate@helioscx.demo",
      examId: "exam-1",
      examAttemptId: "ea-1",
      actor: {
        type: "candidate",
        id: "candidate-owner",
        email: "candidate@helioscx.demo",
      },
      subject: {
        type: "exam_attempt",
        id: "ea-1",
      },
      message: "Candidate lab window was blocked by the browser",
      details: {
        attemptedAction: "open",
        attemptStatus: "in_progress",
        reportedAttemptStatus: "in_progress",
        failureReason: "popup_blocked",
        candidateMessage:
          "The exam window was blocked by your browser. Allow popups for this site, then use Open exam window to retry.",
        route: "/api/candidate/runtime-diagnostics",
      },
    });
  });
});
