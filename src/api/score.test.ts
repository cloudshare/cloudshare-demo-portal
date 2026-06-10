import { describe, it, expect, vi } from "vitest";
import { handleRetrieveScore } from "./score";
import type { Logger } from "@/observability/logger";
import type { ScoreRetrievalProvider, ParticipantProgress } from "@/domain/score-result";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { LabLaunch } from "@/domain/lab-launch";
import { LabLaunchNotFoundError, ScoreRetrievalError } from "@/domain/errors";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const sampleProgress: ParticipantProgress = {
  percentComplete: 50,
  stepsCompleted: 2,
  stepsTotal: 4,
  steps: [
    { stepId: "s1", title: "Step 1", completed: true },
    { stepId: "s2", title: "Step 2", completed: true },
    { stepId: "s3", title: "Step 3", completed: false },
    { stepId: "s4", title: "Step 4", completed: false },
  ],
};

function makeLaunch(): LabLaunch {
  return {
    id: "launch-1",
    examAttemptId: "attempt-1",
    candidateId: "candidate-1",
    experienceId: "exp-1",
    environmentExternalId: "env-1",
    loginUrl: "https://example.com/login",
    status: "launched",
    createdAt: new Date(),
  };
}

const TEST_LIMITATIONS = ["Limitation A", "Limitation B"];

function makeDeps(launch: LabLaunch | null, progress: ParticipantProgress | null) {
  const launches: LabLaunchRepository = {
    save: vi.fn(),
    findById: vi.fn(),
    findByExamAttemptId: vi.fn().mockResolvedValue(launch),
  };
  const scoreRetriever: ScoreRetrievalProvider = {
    getParticipantProgress: vi.fn().mockResolvedValue(progress),
  };
  return { launches, scoreRetriever, logger: makeLogger(), limitations: TEST_LIMITATIONS };
}

describe("handleRetrieveScore", () => {
  it("returns 200 with ScoreResult and limitations for a valid examAttemptId", async () => {
    const deps = makeDeps(makeLaunch(), sampleProgress);
    const result = await handleRetrieveScore(deps, { query: { examAttemptId: "attempt-1" } });

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.examAttemptId).toBe("attempt-1");
    expect(body.percentComplete).toBe(50);
    expect(body.limitations).toBeInstanceOf(Array);
    expect((body.limitations as string[]).length).toBeGreaterThan(0);
  });

  it("returns 400 when examAttemptId is missing", async () => {
    const deps = makeDeps(null, null);
    const result = await handleRetrieveScore(deps, { query: {} });
    expect(result.status).toBe(400);
  });

  it("returns 404 when no lab launch exists for the attempt", async () => {
    const deps = makeDeps(null, null);
    // override launches to throw LabLaunchNotFoundError
    (deps.launches.findByExamAttemptId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await handleRetrieveScore(deps, { query: { examAttemptId: "no-such" } });
    expect(result.status).toBe(404);
  });

  it("returns 502 when score retrieval fails", async () => {
    const deps = makeDeps(makeLaunch(), null);
    (deps.scoreRetriever.getParticipantProgress as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("cloudshare down"),
    );
    const result = await handleRetrieveScore(deps, { query: { examAttemptId: "attempt-1" } });
    expect(result.status).toBe(502);
  });
});
