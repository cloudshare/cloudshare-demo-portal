import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCompleteExamAttemptEarlyRuntime } = vi.hoisted(() => ({
  mockCompleteExamAttemptEarlyRuntime: vi.fn(),
}));

vi.mock("./exam-attempt-early-completion-runtime", () => ({
  completeExamAttemptEarlyRuntime: mockCompleteExamAttemptEarlyRuntime,
}));

import {
  handleCandidateCompleteExamRoute,
  type CandidateEarlyCompletionServices,
} from "./candidate-early-completion-route";
import type { PortalSession } from "@/auth/portal-stores";

function makeServices(): CandidateEarlyCompletionServices {
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
  } as unknown as CandidateEarlyCompletionServices;
}

const candidateSession: PortalSession = {
  sessionId: "portal-session-1",
  userId: "candidate-1",
  customerId: "customer-1",
  role: "candidate",
  email: "candidate@helioscx.demo",
  issuedAtMs: 1,
};

describe("candidate early completion route workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteExamAttemptEarlyRuntime.mockReset();
  });

  it("rejects unauthenticated complete requests before runtime side effects", async () => {
    const services = makeServices();

    const response = await handleCandidateCompleteExamRoute(services, {
      sessionId: undefined,
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(null),
    });

    expect(response).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(mockCompleteExamAttemptEarlyRuntime).not.toHaveBeenCalled();
    expect(services.examAttempts.findById).not.toHaveBeenCalled();
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });

  it("removes heartbeat tracking and writes audit after successful early completion", async () => {
    const services = makeServices();
    mockCompleteExamAttemptEarlyRuntime.mockResolvedValue({
      status: 200,
      body: { status: "completed", examAttemptId: "ea-1" },
    });

    const response = await handleCandidateCompleteExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({
      status: 200,
      body: { status: "completed", examAttemptId: "ea-1" },
    });
    expect(mockCompleteExamAttemptEarlyRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateEmail: "candidate@helioscx.demo",
      }),
      { examAttemptId: "ea-1" },
    );
    expect(services.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("ea-1");
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "ea-1",
        action: "exam_completed_early",
        outcome: "success",
      }),
    );
  });

  it("keeps heartbeat and audit untouched when CloudShare cleanup is pending", async () => {
    const services = makeServices();
    mockCompleteExamAttemptEarlyRuntime.mockResolvedValue({
      status: 202,
      body: {
        status: "pending",
        operation: "complete",
        examAttemptId: "ea-1",
        retryable: true,
        correlationId: "corr-complete",
        message: "CloudShare is still stopping your lab. Wait a few seconds, then retry End exam.",
      },
    });

    const response = await handleCandidateCompleteExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response.status).toBe(202);
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });
});
