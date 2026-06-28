import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHandleResumeExam,
  mockHandleSuspendExam,
} = vi.hoisted(() => ({
  mockHandleResumeExam: vi.fn(),
  mockHandleSuspendExam: vi.fn(),
}));

vi.mock("./suspend-resume", () => ({
  handleResumeExam: mockHandleResumeExam,
  handleSuspendExam: mockHandleSuspendExam,
}));

import {
  handleCandidateResumeExamRoute,
  handleCandidateSuspendExamRoute,
  type CandidateSuspendResumeServices,
} from "./candidate-suspend-resume-route";
import type { PortalSession } from "@/auth/portal-stores";

function makeServices(): CandidateSuspendResumeServices {
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
  } as unknown as CandidateSuspendResumeServices;
}

const candidateSession: PortalSession = {
  sessionId: "portal-session-1",
  userId: "candidate-1",
  customerId: "customer-1",
  role: "candidate",
  email: "candidate@helioscx.demo",
  issuedAtMs: 1,
};

describe("candidate suspend/resume route workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleResumeExam.mockReset();
    mockHandleSuspendExam.mockReset();
  });

  it("rejects unauthenticated suspend requests before runtime side effects", async () => {
    const services = makeServices();

    const response = await handleCandidateSuspendExamRoute(services, {
      sessionId: undefined,
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(null),
    });

    expect(response).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(mockHandleSuspendExam).not.toHaveBeenCalled();
    expect(services.examAttempts.findById).not.toHaveBeenCalled();
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });

  it("keeps successful suspend heartbeat cleanup and audit behavior", async () => {
    const services = makeServices();
    mockHandleSuspendExam.mockResolvedValue({
      status: 200,
      body: { status: "suspended", examAttemptId: "ea-1" },
    });

    const response = await handleCandidateSuspendExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({
      status: 200,
      body: { status: "suspended", examAttemptId: "ea-1" },
    });
    expect(services.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("ea-1");
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "ea-1",
        action: "lab_suspended",
        outcome: "success",
      }),
    );
  });

  it("keeps successful resumed resume heartbeat cleanup and audit behavior", async () => {
    const services = makeServices();
    mockHandleResumeExam.mockResolvedValue({
      status: 200,
      body: {
        status: "resumed",
        resumeDisposition: "resumed",
        examAttemptId: "ea-1",
      },
    });

    const response = await handleCandidateResumeExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({
      status: 200,
      body: {
        status: "resumed",
        resumeDisposition: "resumed",
        examAttemptId: "ea-1",
      },
    });
    expect(services.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("ea-1");
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "ea-1",
        action: "lab_resumed",
        outcome: "success",
      }),
    );
  });

  it("does not clear heartbeat state for idempotent already-active resume", async () => {
    const services = makeServices();
    mockHandleResumeExam.mockResolvedValue({
      status: 200,
      body: {
        status: "resumed",
        resumeDisposition: "already_active",
        examAttemptId: "ea-1",
      },
    });

    const response = await handleCandidateResumeExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({
      status: 200,
      body: {
        status: "resumed",
        resumeDisposition: "already_active",
        examAttemptId: "ea-1",
      },
    });
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });

  it("writes a failed suspend audit without clearing heartbeat state for 5xx responses", async () => {
    const services = makeServices();
    mockHandleSuspendExam.mockResolvedValue({
      status: 502,
      body: { error: "exam suspend failed", correlationId: "corr-1" },
    });

    const response = await handleCandidateSuspendExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({
      status: 502,
      body: { error: "exam suspend failed", correlationId: "corr-1" },
    });
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "ea-1",
        action: "lab_suspend_failed",
        outcome: "failure",
        error: "exam suspend failed",
      }),
    );
  });

  it("writes a failed resume audit without clearing heartbeat state for 5xx responses", async () => {
    const services = makeServices();
    mockHandleResumeExam.mockResolvedValue({
      status: 502,
      body: { error: "exam resume failed", correlationId: "corr-2" },
    });

    const response = await handleCandidateResumeExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: "ea-1" },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({
      status: 502,
      body: { error: "exam resume failed", correlationId: "corr-2" },
    });
    expect(services.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "ea-1",
        action: "lab_resume_failed",
        outcome: "failure",
        error: "exam resume failed",
      }),
    );
  });

  it("authorizes using the raw examAttemptId value before the runtime trims request bodies", async () => {
    const services = makeServices();
    mockHandleSuspendExam.mockResolvedValue({
      status: 200,
      body: { status: "suspended", examAttemptId: "ea-1" },
    });
    services.examAttempts.findById = vi.fn().mockImplementation(async (examAttemptId: string) => {
      if (examAttemptId !== "ea-1") return null;
      return {
        id: "ea-1",
        customerId: "customer-1",
        candidateId: "candidate-1",
        examId: "exam-1",
        status: "in_progress",
        scheduledFor: new Date("2026-06-21T09:00:00.000Z"),
        createdAt: new Date("2026-06-21T08:00:00.000Z"),
      };
    });

    const response = await handleCandidateSuspendExamRoute(services, {
      sessionId: "portal-session-1",
      body: { examAttemptId: " ea-1 " },
      getPortalSession: vi.fn().mockResolvedValue(candidateSession),
    });

    expect(response).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(services.examAttempts.findById).toHaveBeenCalledWith(" ea-1 ");
    expect(mockHandleSuspendExam).not.toHaveBeenCalled();
    expect(services.audit.write).not.toHaveBeenCalled();
  });
});
