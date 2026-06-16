import { InvalidExamAttemptStatusError, LabLaunchNotFoundError, TimerSyncError } from "./errors";
import type { ExamAttemptRepository } from "./exam-attempt";
import type { EnvironmentController, EnvironmentStateSource, EnvironmentStatus } from "./environment";
import type { ExamAttemptStatus } from "./exam-attempt";
import type { LabLaunchRepository, LabProvisioner } from "./lab-launch";

/**
 * Suspend/resume synchronised with the Kryterion authoritative exam clock.
 *
 * Flow for suspend:
 *   0. Confirm the ExamAttempt is currently `in_progress`.
 *   1. Look up the LabLaunch to get `environmentExternalId`.
 *   2. Issue the suspend command to CloudShare.
 *   3. Poll `EnvironmentStateSource` until status is `suspended` (webhook hints
 *      from Slice 6 may also trigger reconcile in parallel; this poll is the
 *      authoritative confirmation gate).
 *   4. Pause the Kryterion timer once confirmed.
 *
 * Flow for resume is the mirror: confirm `suspended` → resume → poll until
 * CloudShare leaves the suspended state (`running` or `created`/preparing) →
 * resume timer. Re-entry still happens through `/enter`, which remains the
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

/** Kryterion authoritative exam clock port. Implemented by the Kryterion integration. */
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
  throw new TimerSyncError(
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
}

export interface SuspendExamInput {
  readonly examAttemptId: string;
  readonly verifiedEnvironmentExternalId?: string;
}

export async function suspendExam(
  deps: SuspendExamDeps,
  input: SuspendExamInput,
): Promise<void> {
  await requireAttemptStatus(deps.attempts, input.examAttemptId, "in_progress", "suspend");
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch) {
    throw new LabLaunchNotFoundError({ examAttemptId: input.examAttemptId });
  }
  const environmentExternalId = requireEnvironmentExternalId(
    launch,
    input.examAttemptId,
    input.verifiedEnvironmentExternalId,
  );

  await deps.controller.suspendEnvironment(environmentExternalId);
  await pollUntilStatus(
    deps.source,
    deps.sleep,
    environmentExternalId,
    "suspended",
    deps.poll ?? DEFAULT_POLL,
  );
  await deps.timer.pauseTimer(input.examAttemptId);
  await persistAttemptStatus(deps.attempts, input.examAttemptId, "suspended");
}

// --- resumeExam ---

export interface ResumeExamDeps {
  readonly controller: EnvironmentController;
  readonly source: EnvironmentStateSource;
  readonly timer: ExamTimer;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly labs: LabProvisioner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly poll?: PollOptions;
}

export interface ResumeExamInput {
  readonly examAttemptId: string;
  readonly verifiedEnvironmentExternalId?: string;
}

export interface ResumeExamResult {
  readonly environmentExternalId: string;
  /** ~2-hour CloudShare preservation window, in ms. Surface this to the UI. */
  readonly suspendedPreservationLimitMs: number;
}

export async function resumeExam(
  deps: ResumeExamDeps,
  input: ResumeExamInput,
): Promise<ResumeExamResult> {
  await requireAttemptStatus(deps.attempts, input.examAttemptId, "suspended", "resume");
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch) {
    throw new LabLaunchNotFoundError({ examAttemptId: input.examAttemptId });
  }
  const environmentExternalId = requireEnvironmentExternalId(
    launch,
    input.examAttemptId,
    input.verifiedEnvironmentExternalId,
  );

  await deps.controller.resumeEnvironment(environmentExternalId);
  await pollUntilAnyStatus(
    deps.source,
    deps.sleep,
    environmentExternalId,
    ["running", "created"],
    "running",
    deps.poll ?? DEFAULT_POLL,
  );

  await deps.timer.resumeTimer(input.examAttemptId);
  await persistAttemptStatus(deps.attempts, input.examAttemptId, "in_progress");

  return {
    environmentExternalId,
    suspendedPreservationLimitMs: SUSPENDED_PRESERVATION_LIMIT_MS,
  };
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
    throw new TimerSyncError("No CloudShare environment is correlated to this exam attempt yet.", {
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

async function persistAttemptStatus(
  attempts: ExamAttemptRepository,
  examAttemptId: string,
  status: "in_progress" | "suspended",
): Promise<void> {
  const attempt = await requireAttempt(attempts, examAttemptId);
  await attempts.save({
    ...attempt,
    status,
  });
}

async function requireAttempt(
  attempts: ExamAttemptRepository,
  examAttemptId: string,
) {
  const attempt = await attempts.findById(examAttemptId);
  if (!attempt) {
    throw new TimerSyncError("Exam attempt not found.", { examAttemptId });
  }
  return attempt;
}

async function requireAttemptStatus(
  attempts: ExamAttemptRepository,
  examAttemptId: string,
  expectedStatus: "in_progress" | "suspended",
  operation: "suspend" | "resume",
): Promise<void> {
  const attempt = await requireAttempt(attempts, examAttemptId);
  if (attempt.status !== expectedStatus) {
    throw new InvalidExamAttemptStatusError({
      examAttemptId,
      operation,
      expectedStatus,
      currentStatus: attempt.status as ExamAttemptStatus,
    });
  }
}
