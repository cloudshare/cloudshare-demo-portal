import { describe, expect, it, vi } from "vitest";
import type { PortalSession } from "@/auth";
import {
  buildCandidateLogoutAutoSuspendDeps,
  suspendCandidateRunningLabsForLogout,
  type CandidateLogoutAutoSuspendDeps,
  type CandidateLogoutAutoSuspendServices,
} from "./portal-logout-runtime";

const session: PortalSession = {
  sessionId: "portal-session-1",
  userId: "candidate-1",
  customerId: "customer-1",
  role: "candidate",
  email: "candidate@helioscx.demo",
  firstName: "Pat",
  lastName: "Lee",
  issuedAtMs: 1,
};

function makeDeps(overrides: Partial<CandidateLogoutAutoSuspendDeps> = {}) {
  return {
    controller: {},
    source: {},
    timer: {},
    exams: {},
    clocks: {},
    attempts: {
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
    launches: {},
    sleep: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventLog: {},
    connections: {},
    cloudshare: {},
    diagnostics: { record: vi.fn().mockResolvedValue(undefined) },
    candidateEmail: "candidate@helioscx.demo",
    suspendExam: vi.fn().mockResolvedValue({
      status: 200,
      body: { status: "suspended", examAttemptId: "attempt-running" },
    }),
    heartbeatAutoSuspend: { removeHeartbeat: vi.fn() },
    audit: { write: vi.fn().mockResolvedValue(undefined) },
    newId: () => "audit-1",
    now: () => new Date("2026-06-27T10:00:00.000Z"),
    ...overrides,
  } as CandidateLogoutAutoSuspendDeps;
}

function makeServices(
  overrides: Partial<CandidateLogoutAutoSuspendServices> = {},
): CandidateLogoutAutoSuspendServices {
  return {
    environmentController: {},
    environmentSource: {},
    examClock: {},
    exams: {},
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
      ]),
    },
    labLaunches: {},
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    eventLog: {},
    cloudshareConnections: {},
    cloudshareClientFactory: {},
    diagnosticRecorder: { record: vi.fn().mockResolvedValue(undefined) },
    heartbeatAutoSuspend: { removeHeartbeat: vi.fn() },
    audit: { write: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as CandidateLogoutAutoSuspendServices;
}

describe("suspendCandidateRunningLabsForLogout", () => {
  it("builds logout auto-suspend workflow deps from composed portal services", async () => {
    const services = makeServices();
    const customSleep = vi.fn().mockResolvedValue(undefined);
    const suspendExam = vi.fn().mockImplementation(async (deps: CandidateLogoutAutoSuspendDeps) => {
      expect(deps.candidateEmail).toBe("candidate@helioscx.demo");
      expect(deps.sleep).toBe(customSleep);
      return {
        status: 200,
        body: { status: "suspended", examAttemptId: "attempt-running" },
      };
    });

    const deps = buildCandidateLogoutAutoSuspendDeps(services, session, {
      suspendExam,
      sleep: customSleep,
      newId: () => "audit-from-builder",
      now: () => new Date("2026-06-27T11:00:00.000Z"),
    });

    await suspendCandidateRunningLabsForLogout(deps, session);

    expect(suspendExam).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: services.examAttempts,
        launches: services.labLaunches,
        candidateEmail: "candidate@helioscx.demo",
      }),
      { body: { examAttemptId: "attempt-running" } },
    );
    expect(services.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("attempt-running");
    expect(services.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-from-builder",
        occurredAt: new Date("2026-06-27T11:00:00.000Z"),
      }),
    );
  });

  it("suspends only running Candidate labs before logout cleanup completes", async () => {
    const deps = makeDeps();

    await suspendCandidateRunningLabsForLogout(deps, session);

    expect(deps.attempts.listByCandidate).toHaveBeenCalledWith("candidate-1");
    expect(deps.suspendExam).toHaveBeenCalledTimes(1);
    expect(deps.suspendExam).toHaveBeenCalledWith(
      deps,
      { body: { examAttemptId: "attempt-running" } },
    );
    expect(deps.heartbeatAutoSuspend.removeHeartbeat).toHaveBeenCalledWith("attempt-running");
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-1",
        customerId: "customer-1",
        actorType: "candidate",
        actorId: "candidate-1",
        actorEmail: "candidate@helioscx.demo",
        subjectType: "exam_attempt",
        subjectId: "attempt-running",
        examAttemptId: "attempt-running",
        candidateId: "candidate-1",
        candidateEmail: "candidate@helioscx.demo",
        examId: "exam-1",
        action: "lab_suspended",
        outcome: "success",
        details: { reason: "candidate_logout" },
        occurredAt: new Date("2026-06-27T10:00:00.000Z"),
      }),
    );
  });

  it("leaves heartbeat tracking and audit untouched when auto-suspend fails", async () => {
    const deps = makeDeps({
      suspendExam: vi.fn().mockResolvedValue({
        status: 502,
        body: { error: "CloudShare suspend request failed" },
      }),
    });

    await expect(suspendCandidateRunningLabsForLogout(deps, session)).rejects.toThrow(
      "Logout auto-suspend failed for ExamAttempt attempt-running",
    );

    expect(deps.heartbeatAutoSuspend.removeHeartbeat).not.toHaveBeenCalled();
    expect(deps.audit.write).not.toHaveBeenCalled();
  });
});
