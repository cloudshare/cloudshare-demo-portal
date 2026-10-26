import { randomUUID } from "node:crypto";
import {
  ExamAttemptRuntimeError,
  InvalidExamAttemptStatusError,
  LabLaunchNotFoundError,
} from "./errors";
import type { ExamAttemptRepository, ExamAttemptRuntimeCommand, PendingExamAttemptRuntimeCommand } from "./exam-attempt";
import type {
  EnvironmentCommandResult,
  EnvironmentController,
  EnvironmentStateSource,
  EnvironmentStatus,
} from "./environment";
import type { ExamAttemptStatus } from "./exam-attempt";
import type { LabLaunchRepository, LabProvisioner } from "./lab-launch";

/**
 * Portal-owned ExamAttempt runtime lifecycle for suspend/resume and ExamClock updates.
 *
 * Flow for suspend:
 *   0. Confirm the ExamAttempt is currently `in_progress`.
 *   1. Look up the LabLaunch to get `environmentExternalId`.
 *   2. Atomically claim a persisted runtime command, observe state, and let only the owner dispatch.
 *   3. Poll `EnvironmentStateSource` until status is `suspended` (webhook hints
 *      from Slice 6 may also trigger reconcile in parallel; this poll is the
 *      authoritative confirmation gate).
 *   4. Atomically settle the portal-owned ExamClock, status and exact pending command once confirmed.
 *
 * Flow for resume is the mirror: confirm `suspended` → resume → poll until
 * CloudShare leaves the suspended state (`running` or `created`/preparing) →
 * resume the portal-owned ExamClock. Re-entry still happens through `/enter`, which remains the
 * only redirect source for the server-held sponsored link.
 *
 * CloudShare preserves a suspended environment for ~2 hours; the portal surfaces
 * this limit so the UI can warn the candidate.
 */

/** ~2-hour CloudShare suspended-state-preservation window (surfaced to the UI). */
export const SUSPENDED_PRESERVATION_LIMIT_MS = 2 * 60 * 60 * 1000;

// Re-export so callers can import both ports from a single domain module.
export type { EnvironmentController } from "./environment";

// --- Exam timer port ---

/** Portal-owned ExamClock port for ExamAttempt runtime lifecycle transitions. */
export interface ExamTimer {
  pauseTimer(examAttemptId: string): Promise<void>;
  resumeTimer(examAttemptId: string): Promise<void>;
}

// --- Polling ---

export interface PollOptions {
  readonly maxAttempts: number;
  readonly intervalMs: number;
}

const DEFAULT_POLL: PollOptions = { maxAttempts: 20, intervalMs: 2_000 };

async function pollUntilStatus(
  source: EnvironmentStateSource,
  sleep: (ms: number) => Promise<void>,
  environmentExternalId: string,
  target: EnvironmentStatus,
  opts: PollOptions,
): Promise<void> {
  return pollUntilAnyStatus(source, sleep, environmentExternalId, [target], target, opts);
}

async function pollUntilAnyStatus(
  source: EnvironmentStateSource,
  sleep: (ms: number) => Promise<void>,
  environmentExternalId: string,
  targets: readonly EnvironmentStatus[],
  targetLabel: string,
  opts: PollOptions,
): Promise<void> {
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const snapshot = await source.getEnvironmentState(environmentExternalId);
    if (snapshot && targets.includes(snapshot.status)) return;
    if (attempt < opts.maxAttempts - 1) await sleep(opts.intervalMs);
  }
  throw new ExamAttemptRuntimeError(
    `Timed out waiting for environment to become ${targetLabel}`,
    { environmentExternalId, target: targetLabel, maxAttempts: opts.maxAttempts },
  );
}

// --- suspendExam ---

export interface SuspendExamDeps {
  readonly controller: EnvironmentController;
  readonly source: EnvironmentStateSource;
  readonly timer: ExamTimer;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly sleep: (ms: number) => Promise<void>;
  readonly poll?: PollOptions;
  readonly now?: () => Date;
  readonly isDefiniteCommandRejection?: (error: unknown) => boolean;
}

export interface SuspendExamInput {
  readonly examAttemptId: string;
  readonly verifiedEnvironmentExternalId?: string;
}

export async function suspendExam(
  deps: SuspendExamDeps,
  input: SuspendExamInput,
): Promise<EnvironmentCommandResult> {
  return runRuntimeTransition(deps, input, "suspend");
}

// --- resumeExam ---

export interface ResumeExamDeps {
  readonly controller: EnvironmentController;
  readonly source: EnvironmentStateSource;
  readonly timer: ExamTimer;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  /** @deprecated Resume no longer uses provisioning; retained for structural test doubles. */
  readonly labs?: LabProvisioner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly poll?: PollOptions;
  readonly now?: () => Date;
  readonly isDefiniteCommandRejection?: (error: unknown) => boolean;
}

export interface ResumeExamInput {
  readonly examAttemptId: string;
  readonly verifiedEnvironmentExternalId?: string;
}

export interface ResumeExamResult {
  readonly environmentExternalId: string;
  /** ~2-hour CloudShare preservation window, in ms. Surface this to the UI. */
  readonly suspendedPreservationLimitMs: number;
  readonly commandResult: EnvironmentCommandResult;
}

export async function resumeExam(
  deps: ResumeExamDeps,
  input: ResumeExamInput,
): Promise<ResumeExamResult> {
  const commandResult = await runRuntimeTransition(deps, input, "resume");
  return { environmentExternalId: commandResult.externalIds.environmentId, suspendedPreservationLimitMs: SUSPENDED_PRESERVATION_LIMIT_MS, commandResult };
}

// --- archiveExam ---

export interface ArchiveExamDeps {
  readonly controller: EnvironmentController;
  readonly source: EnvironmentStateSource;
  readonly timer: ExamTimer;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly sleep: (ms: number) => Promise<void>;
  readonly poll?: PollOptions;
  readonly now?: () => Date;
  readonly isDefiniteCommandRejection?: (error: unknown) => boolean;
}

export interface ArchiveExamInput {
  readonly examAttemptId: string;
  readonly verifiedEnvironmentExternalId?: string;
}

export interface ArchiveExamResult {
  readonly environmentExternalId: string;
  readonly commandResult: EnvironmentCommandResult | null;
  readonly alreadyArchived: boolean;
}

export async function archiveExam(
  deps: ArchiveExamDeps,
  input: ArchiveExamInput,
): Promise<ArchiveExamResult> {
  const attempt = await requireAttempt(deps.attempts, input.examAttemptId);
  if (attempt.status !== "in_progress" && attempt.status !== "suspended") {
    throw new InvalidExamAttemptStatusError({
      examAttemptId: input.examAttemptId,
      operation: "archive",
      expectedStatus: "in_progress_or_suspended",
      currentStatus: attempt.status as ExamAttemptStatus,
    });
  }

  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch) {
    throw new LabLaunchNotFoundError({ examAttemptId: input.examAttemptId });
  }
  const environmentExternalId = requireEnvironmentExternalId(
    launch,
    input.examAttemptId,
    input.verifiedEnvironmentExternalId,
  );

  const currentState = await deps.source.getEnvironmentState(environmentExternalId);
  if (currentState?.status === "archived") {
    if (attempt.status === "in_progress") {
      await deps.timer.pauseTimer(input.examAttemptId);
    }
    return { environmentExternalId, commandResult: null, alreadyArchived: true };
  }

  const commandResult = await deps.controller.archiveEnvironment(environmentExternalId);
  await pollUntilStatus(
    deps.source,
    deps.sleep,
    environmentExternalId,
    "archived",
    deps.poll ?? DEFAULT_POLL,
  );
  if (attempt.status === "in_progress") {
    await deps.timer.pauseTimer(input.examAttemptId);
  }

  return { environmentExternalId, commandResult, alreadyArchived: false };
}

function requireEnvironmentExternalId(
  launch: {
    readonly id: string;
    readonly trainingId?: string;
    readonly environmentExternalId?: string;
    readonly environmentId?: string;
  },
  examAttemptId: string,
  verifiedEnvironmentExternalId?: string,
): string {
  const correlatedEnvironmentId =
    typeof verifiedEnvironmentExternalId === "string" &&
    verifiedEnvironmentExternalId.length > 0
      ? verifiedEnvironmentExternalId
      : typeof launch.environmentExternalId === "string" && launch.environmentExternalId.length > 0
        ? launch.environmentExternalId
        : typeof launch.environmentId === "string" && launch.environmentId.length > 0
          ? launch.environmentId
          : null;
  if (!correlatedEnvironmentId) {
    throw new ExamAttemptRuntimeError("No CloudShare environment is correlated to this exam attempt yet.", {
      examAttemptId,
      labLaunchId: launch.id,
      trainingId: launch.trainingId,
      attemptedOperation: "resolve_environment_correlation",
      integrationSurface: "cloudshare.v4.training.participant_list",
      method: "GET",
      path: launch.trainingId
        ? `/v4/trainings/${launch.trainingId}/students`
        : "/v4/trainings/{trainingId}/students",
      failureMode: "not_correlated_yet",
      currentEnvironmentExternalId: correlatedEnvironmentId,
    });
  }
  return correlatedEnvironmentId;
}

async function requireAttempt(
  attempts: ExamAttemptRepository,
  examAttemptId: string,
) {
  const attempt = await attempts.findById(examAttemptId);
  if (!attempt) {
    throw new ExamAttemptRuntimeError("Exam attempt not found.", { examAttemptId });
  }
  return attempt;
}


/** One durable owner dispatches. Every later call observes; it never blindly retries. */
async function runRuntimeTransition(deps: SuspendExamDeps | ResumeExamDeps, input: SuspendExamInput, action: "suspend" | "resume"): Promise<EnvironmentCommandResult> {
  const attempt = await requireAttempt(deps.attempts, input.examAttemptId);
  const customerId = attempt.customerId ?? "";
  const { readRuntimeCommand, claimRuntimeCommand, finishRuntimeCommandDispatch, settleRuntimeCommand, releaseRuntimeCommand } = deps.attempts;
  if (!readRuntimeCommand || !claimRuntimeCommand || !finishRuntimeCommandDispatch || !settleRuntimeCommand || !releaseRuntimeCommand) throw new ExamAttemptRuntimeError("Runtime command persistence is unavailable.");
  let command = await readRuntimeCommand(customerId, attempt.id);
  const expectedStatus = action === "suspend" ? "in_progress" : "suspended";
  if (!command && attempt.status !== expectedStatus) throw new InvalidExamAttemptStatusError({ examAttemptId: attempt.id, operation: action, expectedStatus, currentStatus: attempt.status });
  if (!["in_progress", "suspended"].includes(attempt.status)) throw new InvalidExamAttemptStatusError({ examAttemptId: attempt.id, operation: action, expectedStatus, currentStatus: attempt.status });
  const launch = await deps.launches.findByExamAttemptId(attempt.id);
  if (!launch) throw new LabLaunchNotFoundError({ examAttemptId: attempt.id });
  const environmentId = requireEnvironmentExternalId(launch, attempt.id, input.verifiedEnvironmentExternalId);
  if (command && command.environmentId !== environmentId) throw pendingCommand(command);
  let ownsDispatch = false;
  if (!command) {
    const proposed: PendingExamAttemptRuntimeCommand = { phase: "dispatching", customerId, examAttemptId: attempt.id, commandId: randomUUID(), action, environmentId };
    ownsDispatch = await claimRuntimeCommand(proposed, expectedStatus);
    command = ownsDispatch ? proposed : await readRuntimeCommand(customerId, attempt.id);
    if (!command) throw new ExamAttemptRuntimeError("Runtime command changed; refresh the attempt before retrying.");
  }
  if (command.environmentId !== environmentId || (!ownsDispatch && command.phase !== "observing")) throw pendingCommand(command);
  const targetStates: EnvironmentStatus[] = command.action === "suspend" ? ["suspended"] : ["running", "created"];
  let result: EnvironmentCommandResult = { attemptedOperation: `${command.action}_environment`, integrationSurface: "portal.environment.reconciliation", externalIds: { environmentId: command.environmentId } };
  let snapshot;
  try { snapshot = await deps.source.getEnvironmentState(command.environmentId); }
  catch (error) { if (ownsDispatch) await releaseRuntimeCommand(command); throw error; }
  if (!snapshot || !targetStates.includes(snapshot.status)) {
    if (!ownsDispatch) throw pendingCommand(command);
    const eligible = command.action === "suspend" ? snapshot?.status === "running" : snapshot?.status === "suspended";
    if (!eligible) {
      await releaseRuntimeCommand(command);
      throw new ExamAttemptRuntimeError("Environment state does not permit this runtime command.", { failureMode: "environment_state_unavailable", environmentExternalId: command.environmentId });
    }
    try {
      result = command.action === "suspend" ? await deps.controller.suspendEnvironment(command.environmentId) : await deps.controller.resumeEnvironment(command.environmentId);
    } catch (error) {
      if (deps.isDefiniteCommandRejection?.(error)) await releaseRuntimeCommand(command);
      else await finishRuntimeCommandDispatch(command);
      throw error;
    }
    if (!await finishRuntimeCommandDispatch(command)) throw pendingCommand(command);
    command = { ...command, phase: "observing" };
    await pollUntilAnyStatus(deps.source, deps.sleep, command.environmentId, targetStates, command.action === "suspend" ? "suspended" : "running", deps.poll ?? DEFAULT_POLL);
  }
  // From this point the owner cannot send another POST, including the no-op path.
  if (ownsDispatch && command.phase === "dispatching") {
    if (!await finishRuntimeCommandDispatch(command)) throw pendingCommand(command);
    command = { ...command, phase: "observing" };
  }
  if (!await settleRuntimeCommand(command, (deps.now ?? (() => new Date()))())) throw pendingCommand(command);
  if (command.action !== action) throw new ExamAttemptRuntimeError("Previous runtime command reconciled; refresh before another action.", { failureMode: "runtime_command_reconciled" });
  return result;
}

function pendingCommand(command: ExamAttemptRuntimeCommand): ExamAttemptRuntimeError {
  return new ExamAttemptRuntimeError("Runtime command awaits authoritative confirmation; no command was replayed.", { failureMode: "runtime_command_pending", environmentExternalId: command.environmentId, target: command.action === "suspend" ? "suspended" : "running" });
}
