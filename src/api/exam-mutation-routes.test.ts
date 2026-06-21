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
      save: vi.fn(),
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
    examClock: {
      getTimerState: vi.fn().mockResolvedValue(null),
      getElapsedMs: vi.fn().mockResolvedValue(0),
      settleCompletion: vi.fn().mockResolvedValue(null),
    },
    exams: {
      findById: vi.fn().mockResolvedValue({
        id: "exam-1",
        customerId: "customer-1",
        title: "Helios Guided Journey",
        description: "",
        timeLimitMinutes: 90,
        scoreRetrievalEnabled: true,
        status: "published",
        publishedAt: new Date("2026-06-15T09:00:00.000Z"),
        createdAt: new Date("2026-06-15T09:00:00.000Z"),
        updatedAt: new Date("2026-06-15T09:00:00.000Z"),
        projectId: "project-1",
        projectName: "Helios CX Project",
        blueprintId: "bp-1",
        blueprintName: "Guided Journey Blueprint",
        snapshotId: "snap-1",
        snapshotName: "Default Snapshot",
        allowedRegions: [{ id: "region-1", name: "EU West" }],
        policyId: "policy-1",
        policyName: "Policy",
        instructorId: "instructor-1",
        instructorName: "Instructor",
      }),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    heartbeatAutoSuspend: {
      recordHeartbeat: vi.fn(),
      removeHeartbeat: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      checkAll: vi.fn(),
      reset: vi.fn(),
    },
    diagnosticRecorder: { record: vi.fn().mockResolvedValue(undefined) },
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

  it("surfaces completion through heartbeat and stops offering active lab state once runtime is exhausted", async () => {
    const services = makeServices();
    services.examClock = {
      getTimerState: vi.fn().mockResolvedValue({
        examAttemptId: "ea-1",
        status: "running",
        elapsedAtPauseMs: 89 * 60 * 1000,
        startedAt: new Date("2026-06-15T17:29:00.000Z"),
        updatedAt: new Date("2026-06-15T17:29:00.000Z"),
      }),
      getElapsedMs: vi.fn().mockResolvedValue(90 * 60 * 1000),
      settleCompletion: vi.fn().mockResolvedValue({
        examAttemptId: "ea-1",
        status: "paused",
        elapsedAtPauseMs: 90 * 60 * 1000,
        startedAt: null,
        updatedAt: new Date("2026-06-15T17:30:00.000Z"),
      }),
    };
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

    expect(heartbeatResponse.status).toBe(200);
    expect(await heartbeatResponse.json()).toEqual({
      status: "completed",
      attemptStatus: "completed",
    });
    expect(services.heartbeatAutoSuspend.recordHeartbeat).not.toHaveBeenCalled();
    expect(services.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("ea-1");
  });
});
