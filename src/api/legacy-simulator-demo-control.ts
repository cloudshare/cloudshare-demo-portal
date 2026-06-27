import { randomUUID } from "node:crypto";
import type { Services } from "@/composition";
import type { Logger } from "@/observability/logger";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository, LabProvisioner } from "@/domain/lab-launch";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { ExamEligibilityProvider } from "@/domain/eligibility";
import type { IntegrationEventPublisher } from "@/domain/integration-event";
import type { ScoreRetrievalProvider } from "@/domain/score-result";
import type { KryterionSimulator } from "@/integrations/kryterion/simulator";
import type { CloudShareEnvironmentSimulator } from "@/integrations/cloudshare/environment-simulator";
import {
  DEMO_STEPS,
  STEP_META,
  computeStepStatuses,
  type DemoStep,
  type StepStatus,
} from "@/domain/demo-control";
import { DEMO_SEED } from "@/integrations/genesys/demo-data";
import { bookExam } from "@/domain/booking";
import { launchLab } from "@/domain/lab-launch";
import { suspendExam, resumeExam } from "@/domain/timer-sync";
import { retrieveScore } from "@/domain/score-result";

/**
 * Legacy simulator Demo Control Panel handlers.
 *
 * This module intentionally quarantines the retired Genesys/Kryterion simulator
 * flow behind the remaining `/api/demo/*` compatibility surface. It preserves
 * deterministic fixture/demo behavior, but it is not part of the active
 * Certalis/Helios ExamAttempt runtime lifecycle.
 *
 * HTTP contracts:
 *   GET  /api/demo/state  — 200 { seed, steps, currentState }
 *   POST /api/demo/step   — { step } → 200 { ok, result } | 409 step not available | 500
 *   POST /api/demo/reset  — 200 { ok }
 */

// --- Shared types ---

export interface DemoHandlerResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// --- Deps ---

export interface DemoControlDeps {
  readonly logger: Logger;
  // Reads
  readonly examAttempts: ExamAttemptRepository;
  readonly labLaunches: LabLaunchRepository;
  readonly environmentSource: EnvironmentStateSource;
  readonly kryterion: KryterionSimulator;
  readonly completedDemoSteps: ReadonlySet<DemoStep>;
  // Writes (step execution)
  readonly markStepDone: (step: DemoStep) => void;
  readonly genesys: ExamEligibilityProvider;
  readonly events: IntegrationEventPublisher;
  readonly labProvisioner: LabProvisioner;
  readonly environmentSimulator: CloudShareEnvironmentSimulator | null;
  readonly scoreRetriever: ScoreRetrievalProvider;
  // Reset
  readonly resetDemoState: () => Promise<void>;
  // Utilities
  readonly newId: () => string;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
}

// --- State reading helper ---

async function readDemoGates(deps: DemoControlDeps) {
  const allAttempts = await deps.examAttempts.listByCandidate(DEMO_SEED.candidateId);
  const examAttempt =
    allAttempts.find((a) => a.examId === DEMO_SEED.examId) ?? null;

  const labLaunch = examAttempt
    ? await deps.labLaunches.findByExamAttemptId(examAttempt.id)
    : null;

  const environmentStatus = labLaunch
    ? labLaunch.environmentExternalId
      ? (await deps.environmentSource.getEnvironmentState(labLaunch.environmentExternalId))
        ?.status ?? null
      : null
    : null;

  const timerState = examAttempt
    ? deps.kryterion.getTimerState(examAttempt.id)
    : null;

  return { examAttempt, labLaunch, environmentStatus, timerState };
}

// --- GET /api/demo/state ---

export interface GetDemoStateResponse {
  readonly seed: { candidateId: string; examId: string; examTitle: string };
  readonly steps: Array<{
    id: DemoStep;
    label: string;
    description: string;
    status: StepStatus;
  }>;
  readonly currentState: {
    examAttemptId: string | null;
    labLaunchId: string | null;
    environmentStatus: string | null;
    timerStatus: string | null;
    timerElapsedMs: number | null;
  };
}

export async function handleGetDemoState(
  deps: DemoControlDeps,
): Promise<DemoHandlerResponse> {
  const { examAttempt, labLaunch, environmentStatus, timerState } =
    await readDemoGates(deps);

  const statuses = computeStepStatuses({
    examAttemptExists: examAttempt !== null,
    labLaunchExists: labLaunch !== null,
    environmentStatus,
    completedSteps: deps.completedDemoSteps,
  });

  const steps = DEMO_STEPS.map((id) => ({
    ...STEP_META[id],
    status: statuses[id],
  }));

  const body: GetDemoStateResponse = {
    seed: DEMO_SEED,
    steps,
    currentState: {
      examAttemptId: examAttempt?.id ?? null,
      labLaunchId: labLaunch?.id ?? null,
      environmentStatus,
      timerStatus: timerState?.status ?? null,
      timerElapsedMs: timerState
        ? timerState.elapsedAtPause +
          (timerState.status === "running"
            ? Math.max(0, deps.now().getTime() - timerState.startedAt)
            : 0)
        : null,
    },
  };

  return { status: 200, body: body as unknown as Record<string, unknown> };
}

// --- POST /api/demo/step ---

export interface ExecuteStepRequest {
  readonly body: unknown;
}

export async function handleExecuteStep(
  deps: DemoControlDeps,
  request: ExecuteStepRequest,
): Promise<DemoHandlerResponse> {
  const body = request.body;
  if (typeof body !== "object" || body === null) {
    return { status: 400, body: { error: "request body must be a JSON object" } };
  }

  const step = (body as { step?: unknown }).step;
  if (typeof step !== "string" || !(DEMO_STEPS as readonly string[]).includes(step)) {
    return {
      status: 400,
      body: { error: `step must be one of: ${DEMO_STEPS.join(", ")}` },
    };
  }
  const demoStep = step as DemoStep;

  // Guard: step must be available
  const { examAttempt, labLaunch, environmentStatus } = await readDemoGates(deps);
  const statuses = computeStepStatuses({
    examAttemptExists: examAttempt !== null,
    labLaunchExists: labLaunch !== null,
    environmentStatus,
    completedSteps: deps.completedDemoSteps,
  });

  if (statuses[demoStep] !== "available") {
    return {
      status: 409,
      body: {
        error: `step '${demoStep}' is not available (current status: ${statuses[demoStep]})`,
        currentStatus: statuses[demoStep],
      },
    };
  }

  try {
    const result = await runStep(deps, demoStep, { examAttempt, labLaunch });
    deps.markStepDone(demoStep);
    deps.logger.info("demo step completed", { step: demoStep });
    return { status: 200, body: { ok: true, step: demoStep, result } };
  } catch (err) {
    deps.logger.error("demo step failed", {
      step: demoStep,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      status: 500,
      body: { ok: false, step: demoStep, error: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function runStep(
  deps: DemoControlDeps,
  step: DemoStep,
  ctx: {
    examAttempt: Awaited<ReturnType<typeof readDemoGates>>["examAttempt"];
    labLaunch: Awaited<ReturnType<typeof readDemoGates>>["labLaunch"];
  },
): Promise<Record<string, unknown>> {
  switch (step) {
    case "book_exam": {
      const attempt = await bookExam(
        {
          eligibility: deps.genesys,
          attempts: deps.examAttempts,
          events: deps.events,
          newId: deps.newId,
          now: deps.now,
        },
        { candidateId: DEMO_SEED.candidateId, examId: DEMO_SEED.examId },
      );
      return { examAttemptId: attempt.id, status: attempt.status };
    }

    case "launch_lab": {
      if (!ctx.examAttempt) throw new Error("no exam attempt found — run book_exam first");
      const launch = await launchLab(
        {
          attempts: deps.examAttempts,
          labs: deps.labProvisioner,
          launches: deps.labLaunches,
          newId: deps.newId,
          newExternalId: () => `ENVS-demo-${randomUUID()}`,
          now: deps.now,
        },
        { examAttemptId: ctx.examAttempt.id },
      );
      const scoreReadyLaunch = launch.participantId
        ? launch
        : {
            ...launch,
            // Demo mode has no real CloudShare participant-correlation pass, so persist a
            // stable synthetic participant id to keep the score step aligned with the
            // production score-retrieval contract.
            participantId: ctx.examAttempt.candidateId,
          };
      if (scoreReadyLaunch !== launch) {
        await deps.labLaunches.save(scoreReadyLaunch);
      }
      // In demo/fixture mode seed the simulator so the environment appears "running"
      // immediately — in live mode CloudShare emits environment.resumed via webhook.
      if (deps.environmentSimulator) {
        if (!scoreReadyLaunch.environmentExternalId) {
          throw new Error("lab launch has no correlated environmentExternalId");
        }
        await deps.environmentSimulator.resumeEnvironment(scoreReadyLaunch.environmentExternalId);
      }
      await deps.kryterion.resumeTimer(ctx.examAttempt.id);
      await deps.examAttempts.save({
        ...ctx.examAttempt,
        status: "in_progress",
      });
      return {
        labLaunchId: scoreReadyLaunch.id,
        environmentExternalId: scoreReadyLaunch.environmentExternalId,
      };
    }

    case "suspend_exam": {
      if (!ctx.examAttempt) throw new Error("no exam attempt found");
      await suspendExam(
        {
          controller: deps.environmentSimulator ?? (() => { throw new Error("no env controller"); })() as never,
          source: deps.environmentSource,
          timer: deps.kryterion,
          attempts: deps.examAttempts,
          launches: deps.labLaunches,
          sleep: deps.sleep,
          poll: { maxAttempts: 5, intervalMs: 200 },
        },
        { examAttemptId: ctx.examAttempt.id },
      );
      return { status: "suspended" };
    }

    case "resume_exam": {
      if (!ctx.examAttempt) throw new Error("no exam attempt found");
      const result = await resumeExam(
        {
          controller: deps.environmentSimulator ?? (() => { throw new Error("no env controller"); })() as never,
          source: deps.environmentSource,
          timer: deps.kryterion,
          attempts: deps.examAttempts,
          launches: deps.labLaunches,
          labs: deps.labProvisioner,
          sleep: deps.sleep,
          poll: { maxAttempts: 5, intervalMs: 200 },
        },
        { examAttemptId: ctx.examAttempt.id },
      );
      return {
        status: "resumed",
        environmentExternalId: result.environmentExternalId,
        suspendedPreservationLimitMs: result.suspendedPreservationLimitMs,
      };
    }

    case "retrieve_score": {
      if (!ctx.examAttempt) throw new Error("no exam attempt found");
      const score = await retrieveScore(
        { launches: deps.labLaunches, scoreRetriever: deps.scoreRetriever },
        { examAttemptId: ctx.examAttempt.id },
      );
      return {
        percentComplete: score.percentComplete,
        stepsCompleted: score.stepsCompleted,
        stepsTotal: score.stepsTotal,
      };
    }
  }
}

// --- POST /api/demo/reset ---

export async function handleResetDemo(deps: DemoControlDeps): Promise<DemoHandlerResponse> {
  await deps.resetDemoState();
  deps.logger.info("demo state reset");
  return { status: 200, body: { ok: true } };
}

// --- Deps factory ---

/** Build the full DemoControlDeps from the composition root Services. */
export function buildDemoDeps(svc: Services): DemoControlDeps {
  return {
    logger: svc.logger,
    examAttempts: svc.examAttempts,
    labLaunches: svc.labLaunches,
    environmentSource: svc.environmentSource,
    kryterion: svc.legacySimulatorDemo.kryterion,
    completedDemoSteps: svc.legacyDemoRuntimeControls.completedDemoSteps,
    markStepDone: svc.legacyDemoRuntimeControls.markStepDone,
    genesys: svc.legacySimulatorDemo.genesys,
    events: svc.events,
    labProvisioner: svc.labProvisioner,
    environmentSimulator: svc.environmentSimulator,
    scoreRetriever: svc.scoreRetriever,
    resetDemoState: svc.legacyDemoRuntimeControls.resetDemo,
    newId: () => randomUUID(),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
