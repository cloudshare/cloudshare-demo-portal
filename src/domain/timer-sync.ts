import { TimerSyncError } from "./errors";
import type { EnvironmentStateSource, EnvironmentStatus } from "./environment";
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
 * Flow for resume is the mirror: resume → poll until `running` → resume timer →
 * issue a new sponsored link so the candidate can reopen the preserved session.
 *
 * CloudShare preserves a suspended environment for ~2 hours; the portal surfaces
 * this limit so the UI can warn the candidate.
 */

/** ~2-hour CloudShare suspended-state-preservation window (surfaced to the UI). */
export const SUSPENDED_PRESERVATION_LIMIT_MS = 2 * 60 * 60 * 1000;

// --- Ports ---

/** Kryterion authoritative exam clock port. Implemented by the Kryterion integration. */
export interface ExamTimer {
  pauseTimer(examAttemptId: string): Promise<void>;
  resumeTimer(examAttemptId: string): Promise<void>;
}

/** CloudShare environment lifecycle commands port. Implemented by the CloudShare integration. */
export interface EnvironmentController {
  suspendEnvironment(environmentExternalId: string): Promise<void>;
  resumeEnvironment(environmentExternalId: string): Promise<void>;
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
    throw new TimerSyncError("No lab launch found for exam attempt", {
      examAttemptId: input.examAttemptId,
    });
  }

  await deps.controller.suspendEnvironment(launch.environmentExternalId);
  await pollUntilStatus(
    deps.source,
    deps.sleep,
    launch.environmentExternalId,
    "suspended",
    deps.poll ?? DEFAULT_POLL,
  );
  await deps.timer.pauseTimer(input.examAttemptId);
}

// --- resumeExam ---

export interface ResumeExamDeps {
  readonly controller: EnvironmentController;
  readonly source: EnvironmentStateSource;
  readonly timer: ExamTimer;
  readonly launches: LabLaunchRepository;
  readonly labs: LabProvisioner;
  readonly sleep: (ms: number) => Promise<void>;
  readonly poll?: PollOptions;
}

export interface ResumeExamInput {
  readonly examAttemptId: string;
}

export interface ResumeExamResult {
  readonly loginUrl: string;
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
    throw new TimerSyncError("No lab launch found for exam attempt", {
      examAttemptId: input.examAttemptId,
    });
  }

  await deps.controller.resumeEnvironment(launch.environmentExternalId);
  await pollUntilStatus(
    deps.source,
    deps.sleep,
    launch.environmentExternalId,
    "running",
    deps.poll ?? DEFAULT_POLL,
  );
  await deps.timer.resumeTimer(input.examAttemptId);

  const link = await deps.labs.createSponsoredLink({ experienceId: launch.experienceId });
  return {
    loginUrl: link.loginUrl,
    environmentExternalId: launch.environmentExternalId,
    suspendedPreservationLimitMs: SUSPENDED_PRESERVATION_LIMIT_MS,
  };
}
