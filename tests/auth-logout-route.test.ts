import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetServices,
  mockHandleSuspendExam,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockHandleSuspendExam: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("@/composition", () => ({
  getServices: mockGetServices,
  getPortalSessionServices: mockGetServices,
  getPortalLogoutServices: mockGetServices,
}));

vi.mock("@/api/suspend-resume", () => ({
  handleSuspendExam: mockHandleSuspendExam,
}));

import { POST } from "../app/api/auth/logout/route";

function makeServices() {
  return {
    ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
    portalAuth: {
      resume: vi.fn().mockResolvedValue({
        sessionId: "portal-session-1",
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
        email: "candidate@helioscx.demo",
        firstName: "Pat",
        lastName: "Lee",
        issuedAtMs: 1,
      }),
      signOut: vi.fn().mockResolvedValue(undefined),
      signIn: vi.fn(),
    },
    examAttempts: {
      listByCandidate: vi.fn().mockResolvedValue([
        {
          id: "attempt-running",
          customerId: "customer-1",
          candidateId: "candidate-1",
          examId: "exam-1",
          status: "in_progress",
          scheduledFor: new Date("2026-06-25T09:00:00.000Z"),
          createdAt: new Date("2026-06-25T08:00:00.000Z"),
        },
        {
          id: "attempt-suspended",
          customerId: "customer-1",
          candidateId: "candidate-1",
          examId: "exam-1",
          status: "suspended",
          scheduledFor: new Date("2026-06-24T09:00:00.000Z"),
          createdAt: new Date("2026-06-24T08:00:00.000Z"),
        },
      ]),
    },
    environmentController: {},
    environmentSource: {},
    examClock: {},
    exams: {},
    labLaunches: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventLog: {},
    cloudshareConnections: {},
    cloudshareClientFactory: {},
    diagnosticRecorder: { record: vi.fn().mockResolvedValue(undefined) },
    heartbeatAutoSuspend: { removeHeartbeat: vi.fn() },
    audit: { write: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockHandleSuspendExam.mockResolvedValue({
      status: 200,
      body: { status: "suspended", examAttemptId: "attempt-running" },
    });
  });

  it("auto-suspends running Candidate labs before signing out", async () => {
    const services = makeServices();
    mockGetServices.mockReturnValue(services);

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(services.examAttempts.listByCandidate).toHaveBeenCalledWith("candidate-1");
    expect(mockHandleSuspendExam).toHaveBeenCalledTimes(1);
    expect(mockHandleSuspendExam).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: services.examAttempts,
        candidateEmail: "candidate@helioscx.demo",
      }),
      { body: { examAttemptId: "attempt-running" } },
    );
    expect(services.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("attempt-running");
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "attempt-running",
        candidateId: "candidate-1",
        action: "lab_suspended",
        outcome: "success",
        details: { reason: "candidate_logout" },
      }),
    );
    expect(services.portalAuth.signOut).toHaveBeenCalledWith("portal-session-1");
  });

  it("keeps the Candidate session active when logout auto-suspend fails", async () => {
    const services = makeServices();
    mockGetServices.mockReturnValue(services);
    mockHandleSuspendExam.mockResolvedValue({
      status: 502,
      body: { error: "CloudShare suspend request failed" },
    });

    await expect(POST()).rejects.toThrow(
      "Logout auto-suspend failed for ExamAttempt attempt-running",
    );

    expect(mockHandleSuspendExam).toHaveBeenCalledTimes(1);
    expect(services.portalAuth.signOut).not.toHaveBeenCalled();
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });
});
