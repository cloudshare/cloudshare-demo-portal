import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as suspendPOST } from "../../app/api/exam/suspend/route";
import { POST as resumePOST } from "../../app/api/exam/resume/route";
import { POST as heartbeatPOST } from "../../app/api/heartbeat/route";

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

function makeServices() {
  return {
    examAttempts: {
      findById: vi.fn().mockResolvedValue({
        id: "ea-1",
        customerId: "customer-1",
        candidateId: "candidate-owner",
        examId: "exam-1",
        status: "in_progress",
        scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
        createdAt: new Date("2026-06-15T10:00:00.000Z"),
      }),
    },
    labLaunches: {
      findByExamAttemptId: vi.fn().mockResolvedValue({
        id: "launch-1",
        examAttemptId: "ea-1",
      }),
    },
    environmentSource: {},
    environmentController: {},
    labProvisioner: {},
    examClock: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    heartbeatAutoSuspend: {
      recordHeartbeat: vi.fn(),
      removeHeartbeat: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      checkAll: vi.fn(),
      reset: vi.fn(),
    },
    audit: { write: vi.fn() },
    eventLog: { append: vi.fn() },
  };
}

function makeRequest(url: string) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ examAttemptId: "ea-1" }),
  });
}

describe("candidate exam mutation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({
      get: () => ({ value: "portal-session-1" }),
    });
  });

  it("rejects unauthenticated suspend/resume/heartbeat requests before mutating state", async () => {
    const services = makeServices();
    mockGetServices.mockReturnValue(services);
    mockGetPortalSession.mockResolvedValue(null);

    const suspendResponse = await suspendPOST(makeRequest("http://localhost/api/exam/suspend"));
    const resumeResponse = await resumePOST(makeRequest("http://localhost/api/exam/resume"));
    const heartbeatResponse = await heartbeatPOST(makeRequest("http://localhost/api/heartbeat"));

    expect(suspendResponse.status).toBe(401);
    expect(await suspendResponse.json()).toEqual({ error: "unauthorized" });
    expect(resumeResponse.status).toBe(401);
    expect(await resumeResponse.json()).toEqual({ error: "unauthorized" });
    expect(heartbeatResponse.status).toBe(401);
    expect(await heartbeatResponse.json()).toEqual({ error: "unauthorized" });

    expect(services.examAttempts.findById).not.toHaveBeenCalled();
    expect(services.heartbeatAutoSuspend.recordHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });

  it("rejects suspend/resume/heartbeat for another candidate's exam attempt", async () => {
    const services = makeServices();
    mockGetServices.mockReturnValue(services);
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      userId: "candidate-foreign",
      customerId: "customer-1",
      role: "candidate",
      email: "candidate@example.com",
      issuedAtMs: 1,
    });

    const suspendResponse = await suspendPOST(makeRequest("http://localhost/api/exam/suspend"));
    const resumeResponse = await resumePOST(makeRequest("http://localhost/api/exam/resume"));
    const heartbeatResponse = await heartbeatPOST(makeRequest("http://localhost/api/heartbeat"));

    expect(suspendResponse.status).toBe(403);
    expect(await suspendResponse.json()).toEqual({ error: "forbidden" });
    expect(resumeResponse.status).toBe(403);
    expect(await resumeResponse.json()).toEqual({ error: "forbidden" });
    expect(heartbeatResponse.status).toBe(403);
    expect(await heartbeatResponse.json()).toEqual({ error: "forbidden" });

    expect(services.examAttempts.findById).toHaveBeenCalledTimes(3);
    expect(services.heartbeatAutoSuspend.recordHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });

  it("rejects heartbeat when the candidate attempt is not in progress", async () => {
    const services = makeServices();
    services.examAttempts.findById = vi.fn().mockResolvedValue({
      id: "ea-1",
      customerId: "customer-1",
      candidateId: "candidate-owner",
      examId: "exam-1",
      status: "suspended",
      scheduledFor: new Date("2026-06-15T16:00:00.000Z"),
      createdAt: new Date("2026-06-15T10:00:00.000Z"),
    });
    mockGetServices.mockReturnValue(services);
    mockGetPortalSession.mockResolvedValue({
      sessionId: "portal-session-1",
      userId: "candidate-owner",
      customerId: "customer-1",
      role: "candidate",
      email: "candidate@example.com",
      issuedAtMs: 1,
    });

    const heartbeatResponse = await heartbeatPOST(makeRequest("http://localhost/api/heartbeat"));

    expect(heartbeatResponse.status).toBe(409);
    expect(await heartbeatResponse.json()).toEqual({ error: "exam attempt is not in progress" });
    expect(services.heartbeatAutoSuspend.recordHeartbeat).not.toHaveBeenCalled();
  });
});
