import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetServices,
  mockGetPortalSession,
  mockHandleResumeExam,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetServices: vi.fn(),
  mockGetPortalSession: vi.fn(),
  mockHandleResumeExam: vi.fn(),
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

vi.mock("@/api/suspend-resume", () => ({
  handleResumeExam: mockHandleResumeExam,
}));

import { POST } from "../app/api/exam/resume/route";

function makeServices() {
  return {
    environmentSource: {},
    environmentController: {},
    examAttempts: {
      findById: vi.fn().mockResolvedValue({
        id: "ea-1",
        customerId: "customer-1",
        candidateId: "candidate-1",
        examId: "exam-1",
        status: "in_progress",
        scheduledFor: new Date("2026-06-21T09:00:00.000Z"),
        createdAt: new Date("2026-06-21T08:00:00.000Z"),
      }),
    },
    labLaunches: {
      findByExamAttemptId: vi.fn().mockResolvedValue({ id: "launch-1", examAttemptId: "ea-1" }),
    },
    labProvisioner: {},
    examClock: {},
    exams: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    heartbeatAutoSuspend: {
      removeHeartbeat: vi.fn(),
    },
    audit: { write: vi.fn().mockResolvedValue(undefined) },
    eventLog: { append: vi.fn().mockResolvedValue(undefined) },
    cloudshareConnections: {},
    cloudshareClientFactory: {},
    diagnosticRecorder: { record: vi.fn().mockResolvedValue(undefined) },
  };
}

describe("POST /api/exam/resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      userId: "candidate-1",
      customerId: "customer-1",
      role: "candidate",
      email: "candidate@helioscx.demo",
      issuedAtMs: 1,
    });
    mockGetServices.mockReturnValue(makeServices());
  });

  it("rejects invalid input without leaking the sponsored loginUrl", async () => {
    const response = await POST(
      new Request("http://localhost/api/exam/resume", {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "examAttemptId is required" });
    expect(JSON.stringify(body)).not.toContain("loginUrl");
  });

  it("does not clear heartbeat state for an idempotent already-active resume", async () => {
    const services = makeServices();
    mockGetServices.mockReturnValue(services);
    mockHandleResumeExam.mockResolvedValue({
      status: 200,
      body: {
        status: "resumed",
        resumeDisposition: "already_active",
        examAttemptId: "ea-1",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/exam/resume", {
        method: "POST",
        body: JSON.stringify({ examAttemptId: "ea-1" }),
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });
});
