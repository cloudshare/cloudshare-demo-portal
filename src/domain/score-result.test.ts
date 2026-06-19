import { describe, it, expect, vi } from "vitest";
import { resolveExamAttemptScore, retrieveScore } from "./score-result";
import type { ScoreRetrievalProvider, ParticipantProgress } from "./score-result";
import type { LabLaunchRepository } from "./lab-launch";
import type { LabLaunch } from "./lab-launch";
import { LabLaunchNotFoundError, ScoreRetrievalError } from "./errors";

function makeLaunch(partial: Partial<LabLaunch> = {}): LabLaunch {
  return {
    id: "launch-1",
    examAttemptId: "attempt-1",
    candidateId: "candidate-1",
    experienceId: "exp-1",
    participantId: "student-1",
    environmentExternalId: "env-ext-1",
    loginUrl: "https://app.example.com/login",
    status: "launched",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...partial,
  };
}

function makeLaunchRepo(launch: LabLaunch | null): LabLaunchRepository {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findByExamAttemptId: vi.fn().mockResolvedValue(launch),
  };
}

const sampleProgress: ParticipantProgress = {
  percentComplete: 75,
  stepsCompleted: 3,
  stepsTotal: 4,
  steps: [
    { stepId: "s1", title: "Configure routing", completed: true, status: "passed" },
    { stepId: "s2", title: "Create queue", completed: true, status: "explored" },
    { stepId: "s3", title: "Test flow", completed: true, status: "passed" },
    { stepId: "s4", title: "Validate output", completed: false, status: "in Progress" },
  ],
  exploredRate: 0.25,
  inProgressRate: 0.25,
  notStartedRate: 0.25,
  passedRate: 0.25,
  failedRate: 0,
  notInitiatedRate: 0.25,
};

function makeProvider(progress: ParticipantProgress | null): ScoreRetrievalProvider {
  return {
    getParticipantProgress: vi.fn().mockResolvedValue(progress),
  };
}

describe("retrieveScore", () => {
  it("returns ScoreResult enriched with exam context when lab launch and progress are found", async () => {
    const launch = makeLaunch();
    const provider = makeProvider(sampleProgress);

    const result = await retrieveScore(
      { launches: makeLaunchRepo(launch), scoreRetriever: provider },
      { examAttemptId: "attempt-1" },
    );

    expect(result.examAttemptId).toBe("attempt-1");
    expect(result.experienceId).toBe("exp-1");
    expect(result.percentComplete).toBe(75);
    expect(result.stepsCompleted).toBe(3);
    expect(result.stepsTotal).toBe(4);
    expect(result.steps).toHaveLength(4);
    expect(result.passedRate).toBe(0.25);
    expect(result.failedRate).toBe(0);
    expect(result.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(provider.getParticipantProgress).toHaveBeenCalledWith("exp-1", "student-1");
  });

  it("returns null-progress ScoreResult when no progress data is available yet", async () => {
    const launch = makeLaunch();
    const provider = makeProvider(null);

    const result = await retrieveScore(
      { launches: makeLaunchRepo(launch), scoreRetriever: provider },
      { examAttemptId: "attempt-1" },
    );

    expect(result.percentComplete).toBe(0);
    expect(result.stepsCompleted).toBe(0);
    expect(result.stepsTotal).toBe(0);
    expect(result.steps).toEqual([]);
    expect(result.passedRate).toBe(0);
    expect(result.failedRate).toBe(0);
  });

  it("throws LabLaunchNotFoundError when no lab launch exists for the attempt", async () => {
    const provider = makeProvider(sampleProgress);

    await expect(
      retrieveScore(
        { launches: makeLaunchRepo(null), scoreRetriever: provider },
        { examAttemptId: "attempt-missing" },
      ),
    ).rejects.toBeInstanceOf(LabLaunchNotFoundError);

    expect(provider.getParticipantProgress).not.toHaveBeenCalled();
  });

  it("wraps provider errors in ScoreRetrievalError", async () => {
    const launch = makeLaunch();
    const provider: ScoreRetrievalProvider = {
      getParticipantProgress: vi.fn().mockRejectedValue(new Error("upstream failure")),
    };

    await expect(
      retrieveScore(
        { launches: makeLaunchRepo(launch), scoreRetriever: provider },
        { examAttemptId: "attempt-1" },
      ),
    ).rejects.toBeInstanceOf(ScoreRetrievalError);
  });
});

describe("resolveExamAttemptScore", () => {
  it("does not call CloudShare when score retrieval is disabled for the Exam", async () => {
    const scoreRetriever: ScoreRetrievalProvider = {
      getParticipantProgress: vi.fn(),
    };

    const result = await resolveExamAttemptScore(
      {
        scoreRetriever,
        now: () => new Date("2026-06-16T12:00:00.000Z"),
      },
      {
        examAttemptId: "attempt-1",
        experienceId: "exp-1",
        participantId: "student-1",
        scoreRetrievalEnabled: false,
      },
    );

    expect(result).toEqual({
      examAttemptId: "attempt-1",
      experienceId: "exp-1",
      scoreAvailable: false,
      reason: "score_retrieval_disabled",
      retrievedAt: "2026-06-16T12:00:00.000Z",
    });
    expect(scoreRetriever.getParticipantProgress).not.toHaveBeenCalled();
  });

  it("returns the mapped score when Guided Journey progress is available", async () => {
    const scoreRetriever: ScoreRetrievalProvider = {
      getParticipantProgress: vi.fn().mockResolvedValue(sampleProgress),
    };

    const result = await resolveExamAttemptScore(
      {
        scoreRetriever,
        now: () => new Date("2026-06-16T12:00:00.000Z"),
      },
      {
        examAttemptId: "attempt-1",
        experienceId: "exp-1",
        participantId: "student-1",
        scoreRetrievalEnabled: true,
      },
    );

    expect(result).toEqual({
      examAttemptId: "attempt-1",
      experienceId: "exp-1",
      scoreAvailable: true,
      percentComplete: 75,
      stepsCompleted: 3,
      stepsTotal: 4,
      steps: sampleProgress.steps,
      exploredRate: 0.25,
      inProgressRate: 0.25,
      notStartedRate: 0.25,
      passedRate: 0.25,
      failedRate: 0,
      notInitiatedRate: 0.25,
      retrievedAt: "2026-06-16T12:00:00.000Z",
    });
  });

  it("degrades to no score available when Guided Journey progress is absent", async () => {
    const scoreRetriever: ScoreRetrievalProvider = {
      getParticipantProgress: vi.fn().mockResolvedValue(null),
    };

    const result = await resolveExamAttemptScore(
      {
        scoreRetriever,
        now: () => new Date("2026-06-16T12:00:00.000Z"),
      },
      {
        examAttemptId: "attempt-1",
        experienceId: "exp-1",
        participantId: "student-1",
        scoreRetrievalEnabled: true,
      },
    );

    expect(result).toEqual({
      examAttemptId: "attempt-1",
      experienceId: "exp-1",
      scoreAvailable: false,
      reason: "no_guided_journey_score",
      retrievedAt: "2026-06-16T12:00:00.000Z",
    });
  });
});
