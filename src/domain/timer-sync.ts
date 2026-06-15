import { LabLaunchNotFoundError, TimerSyncError } from "./errors";
import type { ExamAttemptRepository } from "./exam-attempt";
import type { EnvironmentController, EnvironmentStateSource, EnvironmentStatus } from "./environment";
import type { LabLaunchRepository, LabProvisioner } from "./lab-launch";

/**
 * Suspend/resume synchronised with the Kryterion authoritative exam clock.
 *
 * Flow for suspend:
 *   1. Look up the LabLaunch to get `environmentExternalId`.
 *   2. Issue the suspend command to CloudShare.
 *   3. Poll `EnvironmentStateSource` until status is `suspended` (webhook hints
 *      from Slice 6 may also trigger reconcile in parallel; this poll is the
 *      authoritative confirmation gate).
 *   4. Pause the Kryterion timer once confirmed.
 *
 * Flow for resume is the mirror: resume → poll until `running` → create a fresh
 * sponsored link (so a link failure leaves the timer safely paused) → resume timer.
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
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    const snapshot = await source.getEnvironmentState(environmentExternalId);
    if (snapshot?.status === target) return;
    if (attempt < opts.maxAttempts - 1) await sleep(opts.intervalMs);
  }
  throw new TimerSyncError(
    `Timed out waiting for environment to become ${target}`,
    { environmentExternalId, target, maxAttempts: opts.maxAttempts },
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
}

export async function suspendExam(
  deps: SuspendExamDeps,
  input: SuspendExamInput,
): Promise<void> {
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch) {
    throw new LabLaunchNotFoundError({ examAttemptId: input.examAttemptId });
  }
  const environmentExternalId = requireEnvironmentExternalId(launch, input.examAttemptId);

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
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch) {
    throw new LabLaunchNotFoundError({ examAttemptId: input.examAttemptId });
  }
  const environmentExternalId = requireEnvironmentExternalId(launch, input.examAttemptId);

  await deps.controller.resumeEnvironment(environmentExternalId);
  await pollUntilStatus(
    deps.source,
    deps.sleep,
    environmentExternalId,
    "running",
    deps.poll ?? DEFAULT_POLL,
  );

  // Create the sponsored link before resuming the timer: if the link call fails,
  // the timer stays safely paused and the candidate can retry cleanly.
  const link = await deps.labs.createSponsoredLink({ experienceId: launch.experienceId });
  await deps.launches.save({
    ...launch,
    loginUrl: link.loginUrl,
  });
  await deps.timer.resumeTimer(input.examAttemptId);
  await persistAttemptStatus(deps.attempts, input.examAttemptId, "in_progress");

  return {
    environmentExternalId,
    suspendedPreservationLimitMs: SUSPENDED_PRESERVATION_LIMIT_MS,
  };
}

function requireEnvironmentExternalId(
  launch: { readonly id: string; readonly environmentExternalId?: string },
  examAttemptId: string,
): string {
  if (typeof launch.environmentExternalId !== "string" || launch.environmentExternalId.length === 0) {
    throw new TimerSyncError("No CloudShare environment is correlated to this exam attempt yet.", {
      examAttemptId,
      labLaunchId: launch.id,
    });
  }
  return launch.environmentExternalId;
}

async function persistAttemptStatus(
  attempts: ExamAttemptRepository,
  examAttemptId: string,
  status: "in_progress" | "suspended",
): Promise<void> {
  const attempt = await attempts.findById(examAttemptId);
  if (!attempt) {
    throw new LabLaunchNotFoundError({ examAttemptId });
  }
  await attempts.save({
    ...attempt,
    status,
  });
}
