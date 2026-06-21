import { describe, it, expect, vi } from "vitest";
import { handleGetCandidateScore } from "./score";
import type { Logger } from "@/observability/logger";
import type { AuditRepository } from "@/domain/audit-trail";
import type { ScoreRetrievalProvider, ParticipantProgress } from "@/domain/score-result";
import type { LabLaunchRepository, LabLaunch } from "@/domain/lab-launch";
import type { ExamAttemptRepository, ExamAttempt } from "@/domain/exam-attempt";
import type { ExamRepository, Exam } from "@/domain/exam-catalog";
import type {
  CloudShareConnectionRecord,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { CloudShareTransportError } from "@/integrations/cloudshare";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

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
    scoreRetrievalEnabled: true,
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

const SAMPLE_PROGRESS: ParticipantProgress = {
  percentComplete: 75,
  stepsCompleted: 3,
  stepsTotal: 4,
  steps: [
    { stepId: "s1", title: "Step 1", completed: true, status: "passed" },
    { stepId: "s2", title: "Step 2", completed: true, status: "explored" },
    { stepId: "s3", title: "Step 3", completed: true, status: "passed" },
    { stepId: "s4", title: "Step 4", completed: false, status: "in Progress" },
  ],
  exploredRate: 0.25,
  inProgressRate: 0.25,
  notStartedRate: 0.25,
  passedRate: 0.25,
  failedRate: 0,
  notInitiatedRate: 0.25,
};

const TEST_LIMITATIONS = ["Limitation A", "Limitation B"];

function makeDeps(input?: {
  readonly attempt?: ExamAttempt | null;
  readonly exam?: Exam | null;
  readonly launch?: LabLaunch | null;
  readonly connection?: CloudShareConnectionRecord | null;
  readonly progress?: ParticipantProgress | null;
  readonly progressError?: unknown;
}) {
  let storedLaunch = input?.launch ?? makeLaunch();
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
    save: vi.fn(async (launch: LabLaunch) => {
      storedLaunch = launch;
    }),
    findById: vi.fn(),
    findByExamAttemptId: vi.fn(async () => storedLaunch),
    findByCustomerIdAndEnvironmentExternalId: vi.fn(async () => storedLaunch),
  };
  const audit: AuditRepository = {
    write: vi.fn(),
    listByExamAttemptId: vi.fn(),
    listAll: vi.fn(),
  };
  const connections: CloudShareConnectionRepository = {
    save: vi.fn(),
    markVerified: vi.fn(),
    findByCustomerId: vi
      .fn()
      .mockResolvedValue(
        input?.connection ?? {
          customerId: "customer-1",
          apiId: "api-id",
          apiKey: "api-key",
          webhookSecret: "webhook-secret",
          webhookPathToken: "whk-customer-1",
          connectedAt: new Date("2026-06-16T07:00:00.000Z"),
          verifiedAt: new Date("2026-06-16T07:05:00.000Z"),
        },
      ),
    findByWebhookPathToken: vi.fn(),
  };
  const scoreRetriever: ScoreRetrievalProvider = {
    getParticipantProgress:
      input?.progressError !== undefined
        ? vi.fn().mockRejectedValue(input.progressError)
        : vi
            .fn()
            .mockResolvedValue(
              input && "progress" in input ? (input.progress ?? null) : SAMPLE_PROGRESS,
            ),
  };
  const createScoreRetriever = vi.fn().mockReturnValue(scoreRetriever);
  const participantLister = {
    listParticipants: vi.fn().mockResolvedValue([
      {
        email: "candidate@example.com",
        environmentId: "env-1",
        environmentStatus: "ready",
        studentId: "student-1",
      },
    ]),
  };
  const createParticipantLister = vi.fn().mockReturnValue(participantLister);

  return {
    attempts,
    exams,
    launches,
    audit,
    connections,
    createScoreRetriever,
    createParticipantLister,
    participantLister,
    scoreRetriever,
    logger: makeLogger(),
    limitations: TEST_LIMITATIONS,
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    newCorrelationId: () => "corr-123",
  };
}

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
  });

  it("returns no score available and does not call CloudShare when the Exam flag is off", async () => {
    const deps = makeDeps({
      exam: makeExam({ scoreRetrievalEnabled: false }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      examAttemptId: "attempt-1",
      experienceId: "exp-1",
      scoreRetrievalEnabled: false,
      scoreAvailable: false,
      reason: "score_retrieval_disabled",
      message: "Guided Journey scoring is not enabled for this Exam.",
      retrievedAt: "2026-06-16T12:00:00.000Z",
      limitations: TEST_LIMITATIONS,
    });
    expect(deps.createScoreRetriever).not.toHaveBeenCalled();
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "attempt-1",
        action: "score_retrieved",
        outcome: "success",
        details: {
          experienceId: "exp-1",
          scoreAvailable: false,
          reason: "score_retrieval_disabled",
        },
      }),
    );
  });

  it("returns 409 and does not call CloudShare before the exam attempt is completed", async () => {
    const deps = makeDeps({
      attempt: makeAttempt({ status: "in_progress" }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result).toEqual({
      status: 409,
      body: { error: "score is only available after the exam attempt is completed" },
    });
    expect(deps.exams.findById).not.toHaveBeenCalled();
    expect(deps.launches.findByExamAttemptId).not.toHaveBeenCalled();
    expect(deps.connections.findByCustomerId).not.toHaveBeenCalled();
    expect(deps.createScoreRetriever).not.toHaveBeenCalled();
  });

  it("returns 403 when one candidate tries to retrieve another candidate's score", async () => {
    const deps = makeDeps({
      attempt: makeAttempt({ candidateId: "candidate-2" }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(deps.exams.findById).not.toHaveBeenCalled();
    expect(deps.launches.findByExamAttemptId).not.toHaveBeenCalled();
    expect(deps.createScoreRetriever).not.toHaveBeenCalled();
  });

  it("returns 403 when the exam attempt belongs to a different customer", async () => {
    const deps = makeDeps({
      attempt: makeAttempt({ customerId: "customer-2" }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    expect(deps.exams.findById).not.toHaveBeenCalled();
    expect(deps.launches.findByExamAttemptId).not.toHaveBeenCalled();
    expect(deps.createScoreRetriever).not.toHaveBeenCalled();
  });

  it("returns the candidate score when scoring is enabled", async () => {
    const deps = makeDeps();

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      examAttemptId: "attempt-1",
      experienceId: "exp-1",
      scoreRetrievalEnabled: true,
      scoreAvailable: true,
      percentComplete: 75,
      stepsCompleted: 3,
      stepsTotal: 4,
      steps: SAMPLE_PROGRESS.steps,
      exploredRate: 0.25,
      inProgressRate: 0.25,
      notStartedRate: 0.25,
      passedRate: 0.25,
      failedRate: 0,
      notInitiatedRate: 0.25,
      retrievedAt: "2026-06-16T12:00:00.000Z",
      limitations: TEST_LIMITATIONS,
    });
    expect(deps.createScoreRetriever).toHaveBeenCalledTimes(1);
    expect(deps.scoreRetriever.getParticipantProgress).toHaveBeenCalledWith("exp-1", "student-1");
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "attempt-1",
        action: "score_retrieved",
        outcome: "success",
        details: {
          experienceId: "exp-1",
          scoreAvailable: true,
          percentComplete: 75,
          stepsCompleted: 3,
          stepsTotal: 4,
        },
      }),
    );
  });

  it("returns no score available when Guided Journey progress is absent", async () => {
    const deps = makeDeps({ progress: null });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      examAttemptId: "attempt-1",
      experienceId: "exp-1",
      scoreRetrievalEnabled: true,
      scoreAvailable: false,
      reason: "no_guided_journey_score",
      message: "No Guided Journey score is available for this Exam attempt.",
      retrievedAt: "2026-06-16T12:00:00.000Z",
      limitations: TEST_LIMITATIONS,
    });
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "attempt-1",
        action: "score_retrieved",
        outcome: "success",
        details: {
          experienceId: "exp-1",
          scoreAvailable: false,
          reason: "no_guided_journey_score",
        },
      }),
    );
  });

  it("returns 502 with a correlation id when CloudShare retrieval fails", async () => {
    const deps = makeDeps({
      progressError: new CloudShareTransportError("timeout", {
        method: "GET",
        host: "api.accelerate.cloudshare.com",
        path: "/guided-journey/progress/exp-1/student-1",
        integrationSurface: "cloudshare.v4.guided_journey.progress",
        cause: "ETIMEDOUT",
      }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result).toEqual({
      status: 502,
      body: {
        error: "score retrieval failed",
        correlationId: "corr-123",
      },
    });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "candidate score retrieval failed",
      expect.objectContaining({
        correlationId: "corr-123",
        examAttemptId: "attempt-1",
        attemptedOperation: "get_guided_journey_progress",
        failureMode: "transport",
      }),
    );
    expect(deps.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        examAttemptId: "attempt-1",
        action: "score_retrieved",
        outcome: "failure",
        details: expect.objectContaining({
          experienceId: "exp-1",
          attemptedOperation: "get_guided_journey_progress",
          integrationSurface: "cloudshare.v4.guided_journey.progress",
          method: "GET",
          path: "/guided-journey/progress/exp-1/student-1",
          failureMode: "transport",
        }),
      }),
    );
  });

  it("backfills participant id from training participants when an older launch does not have one yet", async () => {
    const deps = makeDeps({
      launch: makeLaunch({ participantId: undefined }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result.status).toBe(200);
    expect(deps.createParticipantLister).toHaveBeenCalledTimes(1);
    expect(deps.participantLister.listParticipants).toHaveBeenCalledWith("training-1");
    expect(deps.launches.save).toHaveBeenCalledWith(
      expect.objectContaining({
        participantId: "student-1",
      }),
    );
    expect(deps.scoreRetriever.getParticipantProgress).toHaveBeenCalledWith("exp-1", "student-1");
  });

  it("returns a supportable 502 instead of no-score when participant id cannot be resolved", async () => {
    const deps = makeDeps({
      launch: makeLaunch({ participantId: undefined, participantEmail: undefined }),
    });

    const result = await handleGetCandidateScore(deps, {
      query: { examAttemptId: "attempt-1" },
      session: {
        userId: "candidate-1",
        customerId: "customer-1",
        role: "candidate",
      },
    });

    expect(result).toEqual({
      status: 502,
      body: {
        error: "score retrieval failed",
        correlationId: "corr-123",
      },
    });
    expect(deps.createScoreRetriever).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      "candidate score retrieval failed",
      expect.objectContaining({
        attemptedOperation: "resolve_training_participant",
        integrationSurface: "cloudshare.v4.training.participant_list",
        path: "/v4/trainings/training-1/students",
        failureMode: "missing_participant_id",
      }),
    );
  });
});
