import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildCandidateScoreDeps, handleGetCandidateScore } from "./score";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import type { Exam, ExamRepository } from "@/domain/exam-catalog";
import type { LabLaunch, LabLaunchRepository } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import type { CandidateScoreServices } from "./score";

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    customerId: "customer-1",
    candidateId: "candidate-1",
    examId: "exam-1",
    status: "completed",
    scheduledFor: new Date("2026-06-16T09:00:00.000Z"),
    createdAt: new Date("2026-06-16T08:00:00.000Z"),
    ...overrides,
  };
}

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    customerId: "customer-1",
    title: "Helios Exam",
    description: "Guided Journey scoring",
    timeLimitMinutes: 90,
    openPeriodMinutes: 120,
    scoreRetrievalEnabled: false,
    status: "published",
    publishedAt: new Date("2026-06-16T07:00:00.000Z"),
    createdAt: new Date("2026-06-16T07:00:00.000Z"),
    updatedAt: new Date("2026-06-16T07:00:00.000Z"),
    projectId: "project-1",
    projectName: "Project 1",
    blueprintId: "bp-1",
    blueprintName: "Blueprint 1",
    snapshotId: "snap-1",
    snapshotName: "Snapshot 1",
    allowedRegions: [{ id: "region-1", name: "EU West" }],
    policyId: "policy-1",
    policyName: "Policy 1",
    instructorId: "instructor-1",
    instructorName: "Instructor 1",
    ...overrides,
  };
}

function makeLaunch(overrides: Partial<LabLaunch> = {}): LabLaunch {
  return {
    id: "launch-1",
    examAttemptId: "attempt-1",
    candidateId: "candidate-1",
    trainingId: "training-1",
    experienceId: "exp-1",
    participantEmail: "candidate@example.com",
    participantId: "student-1",
    environmentExternalId: "env-1",
    loginUrl: "https://example.com/login",
    status: "launched",
    createdAt: new Date("2026-06-16T08:30:00.000Z"),
    ...overrides,
  };
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeDeps(input?: {
  readonly attempt?: ExamAttempt | null;
  readonly exam?: Exam | null;
}) {
  const attempts: ExamAttemptRepository = {
    save: vi.fn(),
    delete: vi.fn(),
    listByCandidate: vi.fn(),
    findById: vi.fn().mockResolvedValue(input?.attempt ?? makeAttempt()),
  };
  const exams: ExamRepository = {
    save: vi.fn(),
    listByCustomerId: vi.fn(),
    findById: vi.fn().mockResolvedValue(input?.exam ?? makeExam()),
  };
  const launches: LabLaunchRepository = {
    save: vi.fn(),
    findById: vi.fn(),
    findByExamAttemptId: vi.fn().mockResolvedValue(makeLaunch()),
    findByCustomerIdAndEnvironmentExternalId: vi.fn(),
  };
  const audit: AuditRepository = {
    write: vi.fn(),
    listByExamAttemptId: vi.fn(),
    listByExamAttemptIds: vi.fn().mockResolvedValue([]),
    listAll: vi.fn(),
  };
  const connections: CloudShareConnectionRepository = {
    save: vi.fn(),
    markVerified: vi.fn(),
    findByCustomerId: vi.fn().mockResolvedValue(null as CloudShareConnectionRecord | null),
    findByWebhookPathToken: vi.fn(),
  };

  return {
    attempts,
    exams,
    launches,
    audit,
    connections,
    createScoreRetriever: vi.fn(),
    createParticipantLister: vi.fn(),
    logger: makeLogger(),
    limitations: ["Limitation A"],
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    newCorrelationId: () => "corr-123",
  };
}

const CANDIDATE_SESSION = {
  userId: "candidate-1",
  customerId: "customer-1",
  role: "candidate",
};

describe("buildCandidateScoreDeps", () => {
  it("maps the candidate score runtime dependencies from composed portal services", () => {
    const services = {
      examAttempts: {},
      exams: {},
      labLaunches: {},
      audit: {},
      cloudshareConnections: {},
      cloudshareClientFactory: {
        forConnection: vi.fn().mockReturnValue({ requestV4: vi.fn() }),
      },
      logger: makeLogger(),
      diagnosticRecorder: {},
    } as unknown as CandidateScoreServices;

    const deps = buildCandidateScoreDeps(services);

    expect(deps).toMatchObject({
      attempts: services.examAttempts,
      exams: services.exams,
      launches: services.labLaunches,
      audit: services.audit,
      connections: services.cloudshareConnections,
      logger: services.logger,
      diagnostics: services.diagnosticRecorder,
    });
    expect(deps.limitations.length).toBeGreaterThan(0);

    const connection = {
      customerId: "customer-1",
      apiId: "api-id",
      apiKey: "api-key",
      webhookSecret: "webhook-secret",
      webhookPathToken: "webhook-token",
      connectedAt: new Date("2026-06-16T07:00:00.000Z"),
      verifiedAt: null,
    };
    expect(deps.createScoreRetriever(connection)).toHaveProperty("getParticipantProgress");
    expect(deps.createParticipantLister(connection)).toHaveProperty("listParticipants");
    expect(services.cloudshareClientFactory.forConnection).toHaveBeenCalledTimes(2);
    expect(services.cloudshareClientFactory.forConnection).toHaveBeenCalledWith(connection);
  });

  it("keeps the Next route adapter from constructing CloudShare score adapters", () => {
    const routeSource = readFileSync("app/api/exam/score/route.ts", "utf8");

    expect(routeSource).toContain("buildCandidateScoreDeps");
    expect(routeSource).not.toContain("createCloudShareGuidedJourneyProvider");
    expect(routeSource).not.toContain("createCloudShareParticipantLister");
    expect(routeSource).not.toContain("SCORING_LIMITATIONS");
    expect(routeSource).not.toContain("attempts: services.examAttempts");
  });
});

describe("handleGetCandidateScore", () => {
  it("returns 401 when the request is not from an authenticated Candidate", async () => {
    const deps = makeDeps();

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: null,
    });

    expect(result).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(deps.attempts.findById).not.toHaveBeenCalled();
  });

  it("returns 400 when the examAttemptId query value is missing", async () => {
    const deps = makeDeps();

    const result = await handleGetCandidateScore(deps, {
      query: {},
      session: CANDIDATE_SESSION,
    });

    expect(result).toEqual({
      status: 400,
      body: { error: "examAttemptId is required" },
    });
    expect(deps.attempts.findById).not.toHaveBeenCalled();
  });

  it("returns 403 when one Candidate tries to retrieve another Candidate's score", async () => {
    const deps = makeDeps({
      attempt: makeAttempt({ candidateId: "candidate-2" }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: CANDIDATE_SESSION,
    });

    expect(result).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(deps.exams.findById).not.toHaveBeenCalled();
    expect(deps.launches.findByExamAttemptId).not.toHaveBeenCalled();
  });

  it("returns 403 when the ExamAttempt belongs to a different Customer", async () => {
    const deps = makeDeps({
      attempt: makeAttempt({ customerId: "customer-2" }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: CANDIDATE_SESSION,
    });

    expect(result).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(deps.exams.findById).not.toHaveBeenCalled();
    expect(deps.launches.findByExamAttemptId).not.toHaveBeenCalled();
  });

  it("delegates an owned ExamAttempt to the score runtime", async () => {
    const deps = makeDeps();

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: " attempt-1 " },
      session: CANDIDATE_SESSION,
    });

    expect(deps.attempts.findById).toHaveBeenCalledWith("attempt-1");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      examAttemptId: "attempt-1",
      examTitle: "Helios Exam",
      scoreRetrievalEnabled: false,
      scoreAvailable: false,
      reason: "score_retrieval_disabled",
    });
  });
});
