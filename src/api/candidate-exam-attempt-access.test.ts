import { describe, expect, it, vi } from "vitest";
import {
  authorizeCandidateExamAttemptAccess,
  buildCandidateExamAttemptAccessDeps,
} from "./candidate-exam-attempt-access";
import type { ExamAttempt } from "@/domain/exam-attempt";
import type { LabLaunch } from "@/domain/lab-launch";
import type { PortalSession } from "@/auth/portal-stores";

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    customerId: "customer-1",
    candidateId: "candidate-1",
    examId: "exam-1",
    status: "in_progress",
    scheduledFor: new Date("2026-06-27T09:00:00.000Z"),
    createdAt: new Date("2026-06-27T08:00:00.000Z"),
    ...overrides,
  };
}

function makeSession(overrides: Partial<PortalSession> = {}): PortalSession {
  return {
    sessionId: "session-1",
    userId: "candidate-1",
    customerId: "customer-1",
    role: "candidate",
    email: "candidate@helioscx.demo",
    issuedAtMs: 1,
    ...overrides,
  };
}

function makeLaunch(overrides: Partial<LabLaunch> = {}): LabLaunch {
  return {
    id: "launch-1",
    examAttemptId: "attempt-1",
    candidateId: "candidate-1",
    experienceId: "experience-1",
    loginUrl: "https://use.cloudshare.test/login",
    status: "launched",
    createdAt: new Date("2026-06-27T08:30:00.000Z"),
    ...overrides,
  };
}

function makeDeps(input: {
  readonly session?: PortalSession | null;
  readonly attempt?: ExamAttempt | null;
  readonly launch?: LabLaunch | null;
}) {
  return {
    getPortalSession: vi
      .fn()
      .mockResolvedValue("session" in input ? input.session : makeSession()),
    examAttempts: {
      findById: vi.fn().mockResolvedValue("attempt" in input ? input.attempt : makeAttempt()),
    },
    labLaunches: {
      findByExamAttemptId: vi.fn().mockResolvedValue("launch" in input ? input.launch : makeLaunch()),
    },
  };
}

describe("authorizeCandidateExamAttemptAccess", () => {
  it("builds candidate access deps from portal services", async () => {
    const session = makeSession();
    const services = {
      ensurePortalSeeded: vi.fn().mockResolvedValue(undefined),
      portalAuth: {
        resume: vi.fn().mockResolvedValue(session),
      },
      examAttempts: {
        findById: vi.fn(),
      },
      labLaunches: {
        findByExamAttemptId: vi.fn(),
      },
    };

    const deps = buildCandidateExamAttemptAccessDeps(services);
    const resumedSession = await deps.getPortalSession("session-1");

    expect(resumedSession).toEqual(session);
    expect(services.ensurePortalSeeded).toHaveBeenCalledTimes(1);
    expect(services.portalAuth.resume).toHaveBeenCalledWith("session-1");
    expect(deps.examAttempts).toBe(services.examAttempts);
    expect(deps.labLaunches).toBe(services.labLaunches);
  });

  it("authorizes the owning Candidate for their ExamAttempt and LabLaunch", async () => {
    const deps = makeDeps({});

    const result = await authorizeCandidateExamAttemptAccess(deps, {
      sessionId: "session-1",
      examAttemptId: "attempt-1",
      requireLaunch: true,
    });

    expect(result).toEqual({
      ok: true,
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
      },
      attempt: makeAttempt(),
      launch: makeLaunch(),
    });
    expect(deps.getPortalSession).toHaveBeenCalledWith("session-1");
    expect(deps.examAttempts.findById).toHaveBeenCalledWith("attempt-1");
    expect(deps.labLaunches.findByExamAttemptId).toHaveBeenCalledWith("attempt-1");
  });

  it("rejects access when the Candidate does not own the ExamAttempt", async () => {
    const deps = makeDeps({
      session: makeSession({ userId: "candidate-2" }),
      attempt: makeAttempt(),
    });

    const result = await authorizeCandidateExamAttemptAccess(deps, {
      sessionId: "session-1",
      examAttemptId: "attempt-1",
    });

    expect(result).toEqual({
      ok: false,
      response: {
        status: 403,
        body: { error: "forbidden" },
      },
    });
  });

  it("rejects access when the ExamAttempt belongs to another Customer", async () => {
    const deps = makeDeps({
      session: makeSession({ customerId: "customer-2" }),
      attempt: makeAttempt({ customerId: "customer-1" }),
    });

    const result = await authorizeCandidateExamAttemptAccess(deps, {
      sessionId: "session-1",
      examAttemptId: "attempt-1",
    });

    expect(result).toEqual({
      ok: false,
      response: {
        status: 403,
        body: { error: "forbidden" },
      },
    });
  });

  it("requires a LabLaunch when requested", async () => {
    const deps = makeDeps({ launch: null });

    const result = await authorizeCandidateExamAttemptAccess(deps, {
      sessionId: "session-1",
      examAttemptId: "attempt-1",
      requireLaunch: true,
    });

    expect(result).toEqual({
      ok: false,
      response: {
        status: 409,
        body: { error: "exam attempt has no active lab launch" },
      },
    });
  });

  it("requires an in-progress ExamAttempt when requested", async () => {
    const deps = makeDeps({
      attempt: makeAttempt({ status: "suspended" }),
      launch: makeLaunch(),
    });

    const result = await authorizeCandidateExamAttemptAccess(deps, {
      sessionId: "session-1",
      examAttemptId: "attempt-1",
      requireInProgress: true,
    });

    expect(result).toEqual({
      ok: false,
      response: {
        status: 409,
        body: { error: "exam attempt is not in progress" },
      },
    });
  });
});
