import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetDemoState, handleExecuteStep, handleResetDemo, type DemoControlDeps } from "./demo-control";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import { createInMemoryLabLaunchRepository } from "@/persistence/lab-launch-repository";
import { createKryterionSimulator } from "@/integrations/kryterion/simulator";
import { createGenesysSimulator } from "@/integrations/genesys/simulator";
import { genesysDemoData } from "@/integrations/genesys/demo-data";
import { createCloudShareEnvironmentSimulator } from "@/integrations/cloudshare/environment-simulator";
import { createInMemoryEventBus } from "@/domain/event-bus";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { LabProvisioner } from "@/domain/lab-launch";
import type { Logger } from "@/observability/logger";
import type { ScoreRetrievalProvider } from "@/domain/score-result";
import type { DemoStep } from "@/domain/demo-control";
import { DEMO_SEED } from "@/integrations/genesys/demo-data";

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const TEST_SECRET = "test-secret-01234567890123456789012345678901234567890123456789";

/** Returns a CloudShare-fixture-style LabProvisioner that resolves quickly. */
function makeLabProvisioner(): LabProvisioner {
  let n = 0;
  return {
    createExperience: vi.fn().mockResolvedValue({ experienceId: `exp-${++n}` }),
    addStudent: vi.fn().mockResolvedValue(undefined),
    createSponsoredLink: vi.fn().mockResolvedValue({ loginUrl: "https://demo.cloudshare.com/lab" }),
  };
}

function makeScoreRetriever(): ScoreRetrievalProvider {
  return {
    getParticipantProgress: vi.fn().mockResolvedValue({
      percentComplete: 75,
      stepsCompleted: 3,
      stepsTotal: 4,
      steps: [],
    }),
  };
}

function makeDeps(overrides: Partial<DemoControlDeps> = {}): DemoControlDeps {
  const examAttempts = createInMemoryExamAttemptRepository();
  const labLaunches = createInMemoryLabLaunchRepository();
  const simulator = createCloudShareEnvironmentSimulator({ secret: TEST_SECRET });
  const kryterion = createKryterionSimulator({ secret: TEST_SECRET, ttlSeconds: 60 });
  const genesys = createGenesysSimulator(genesysDemoData);
  const events = createInMemoryEventBus({ onError: () => {} });
  const completedDemoStepsWritable = new Set<DemoStep>();
  const completedDemoSteps: ReadonlySet<DemoStep> = completedDemoStepsWritable;
  const markStepDone = vi.fn((step: DemoStep) => completedDemoStepsWritable.add(step));
  const resetDemoState = vi.fn(() => completedDemoStepsWritable.clear());

  return {
    logger: makeLogger(),
    examAttempts,
    labLaunches,
    environmentSource: simulator,
    kryterion,
    completedDemoSteps,
    markStepDone,
    genesys,
    events,
    labProvisioner: makeLabProvisioner(),
    environmentSimulator: simulator,
    scoreRetriever: makeScoreRetriever(),
    resetDemoState,
    newId: (() => { let n = 0; return () => `id-${++n}`; })(),
    now: () => new Date("2026-06-10T12:00:00Z"),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

// ─── handleGetDemoState ─────────────────────────────────────────────────────

describe("handleGetDemoState", () => {
  it("returns 200 with seed, ordered steps, and empty currentState initially", async () => {
    const deps = makeDeps();
    const resp = await handleGetDemoState(deps);

    expect(resp.status).toBe(200);
    const body = resp.body as Record<string, unknown>;
    expect((body.seed as Record<string, unknown>).candidateId).toBe(DEMO_SEED.candidateId);
    expect((body.seed as Record<string, unknown>).examId).toBe(DEMO_SEED.examId);

    const steps = body.steps as Array<{ id: string; status: string }>;
    expect(steps).toHaveLength(5);
    expect(steps[0]).toMatchObject({ id: "book_exam", status: "available" });
    expect(steps[1]).toMatchObject({ id: "launch_lab", status: "pending" });

    const state = body.currentState as Record<string, unknown>;
    expect(state.examAttemptId).toBeNull();
    expect(state.environmentStatus).toBeNull();
    expect(JSON.stringify(state)).not.toContain("loginUrl");
  });

  it("clamps timerElapsedMs to 0 when now() is earlier than startedAt (NTP step-back guard)", async () => {
    const deps = makeDeps();
    // Run book_exam and launch_lab so kryterion has a running timer for the attempt
    await handleExecuteStep(deps, { body: { step: "book_exam" } });
    await handleExecuteStep(deps, { body: { step: "launch_lab" } });

    // Get the exam attempt id so we can inspect timer state
    const attempts = await deps.examAttempts.listByCandidate(DEMO_SEED.candidateId);
    const attemptId = attempts[0].id;

    // Put the kryterion timer into running state so timerState.startedAt is set to a future epoch
    await deps.kryterion.resumeTimer(attemptId);

    // now() is set before startedAt — simulates NTP step-back
    const pastNow = new Date("2000-01-01T00:00:00Z");
    const depsWithPastNow = { ...deps, now: () => pastNow };

    const resp = await handleGetDemoState(depsWithPastNow);
    const state = (resp.body as Record<string, unknown>).currentState as Record<string, unknown>;
    expect(state.timerElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("reflects real ExamAttempt when one exists for the seed", async () => {
    const deps = makeDeps();
    // Pre-seed an attempt
    await deps.examAttempts.save({
      id: "attempt-1",
      candidateId: DEMO_SEED.candidateId,
      examId: DEMO_SEED.examId,
      status: "booked",
      createdAt: new Date(),
    });
    deps.markStepDone("book_exam");

    const resp = await handleGetDemoState(deps);
    const body = resp.body as Record<string, unknown>;
    const state = body.currentState as Record<string, unknown>;
    expect(state.examAttemptId).toBe("attempt-1");

    const steps = body.steps as Array<{ id: string; status: string }>;
    expect(steps.find((s) => s.id === "book_exam")?.status).toBe("done");
    expect(steps.find((s) => s.id === "launch_lab")?.status).toBe("available");
  });
});

// ─── handleExecuteStep ──────────────────────────────────────────────────────

describe("handleExecuteStep", () => {
  it("returns 400 for an invalid step name", async () => {
    const deps = makeDeps();
    const resp = await handleExecuteStep(deps, { body: { step: "not_a_step" } });
    expect(resp.status).toBe(400);
  });

  it("returns 400 for non-object body", async () => {
    const deps = makeDeps();
    const resp = await handleExecuteStep(deps, { body: "string" });
    expect(resp.status).toBe(400);
  });

  it("returns 409 when step is pending (predecessor not done)", async () => {
    const deps = makeDeps();
    const resp = await handleExecuteStep(deps, { body: { step: "launch_lab" } });
    expect(resp.status).toBe(409);
    expect((resp.body as Record<string, unknown>).currentStatus).toBe("pending");
  });

  it("executes book_exam: returns 200, marks step done, persists attempt", async () => {
    const deps = makeDeps();
    const resp = await handleExecuteStep(deps, { body: { step: "book_exam" } });

    expect(resp.status).toBe(200);
    expect((resp.body as Record<string, unknown>).ok).toBe(true);
    expect(deps.completedDemoSteps.has("book_exam")).toBe(true);

    // Attempt was persisted for the seed candidate
    const attempts = await deps.examAttempts.listByCandidate(DEMO_SEED.candidateId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].examId).toBe(DEMO_SEED.examId);
  });

  it("executes launch_lab after book_exam without returning loginUrl, and seeds env running", async () => {
    const deps = makeDeps();
    await handleExecuteStep(deps, { body: { step: "book_exam" } });
    const resp = await handleExecuteStep(deps, { body: { step: "launch_lab" } });

    expect(resp.status).toBe(200);
    const result = (resp.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result).not.toHaveProperty("loginUrl");
    expect(typeof result.environmentExternalId).toBe("string");
    expect(JSON.stringify(result)).not.toContain("loginUrl");

    // Simulator should now report environment as running
    const envState = await deps.environmentSource.getEnvironmentState(
      result.environmentExternalId as string,
    );
    expect(envState?.status).toBe("running");
  });

  it("executes full happy path: all five steps succeed in order", async () => {
    const deps = makeDeps();
    const steps: DemoStep[] = [
      "book_exam",
      "launch_lab",
      "suspend_exam",
      "resume_exam",
      "retrieve_score",
    ];
    for (const step of steps) {
      const resp = await handleExecuteStep(deps, { body: { step } });
      expect(resp.status).toBe(200);
      expect((resp.body as Record<string, unknown>).ok).toBe(true);
    }
    // All five steps should be marked done
    expect(deps.completedDemoSteps.size).toBe(5);
  });

  it("executes resume_exam without returning loginUrl", async () => {
    const deps = makeDeps();
    await handleExecuteStep(deps, { body: { step: "book_exam" } });
    await handleExecuteStep(deps, { body: { step: "launch_lab" } });
    await handleExecuteStep(deps, { body: { step: "suspend_exam" } });

    const resp = await handleExecuteStep(deps, { body: { step: "resume_exam" } });

    expect(resp.status).toBe(200);
    const result = (resp.body as Record<string, unknown>).result as Record<string, unknown>;
    expect(result).not.toHaveProperty("loginUrl");
    expect(result).toMatchObject({ status: "resumed" });
    expect(JSON.stringify(result)).not.toContain("loginUrl");
  });

  it("returns 409 when trying to run a step that is already done", async () => {
    const deps = makeDeps();
    await handleExecuteStep(deps, { body: { step: "book_exam" } });
    // book_exam is now done — running it again should fail
    const resp = await handleExecuteStep(deps, { body: { step: "book_exam" } });
    expect(resp.status).toBe(409);
    expect((resp.body as Record<string, unknown>).currentStatus).toBe("done");
  });
});

// ─── handleResetDemo ────────────────────────────────────────────────────────

describe("handleResetDemo", () => {
  it("returns 200 and calls resetDemoState", async () => {
    const deps = makeDeps();
    deps.markStepDone("book_exam");

    const resp = await handleResetDemo(deps);
    expect(resp.status).toBe(200);
    expect((resp.body as Record<string, unknown>).ok).toBe(true);
    expect(deps.resetDemoState).toHaveBeenCalledOnce();
  });
});
