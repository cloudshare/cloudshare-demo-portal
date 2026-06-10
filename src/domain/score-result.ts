import { LabLaunchNotFoundError, ScoreRetrievalError } from "./errors";
import type { LabLaunchRepository } from "./lab-launch";

/**
 * Guided Journey scoring domain types and the retrieveScore use case.
 *
 * CloudShare's current scoring limitations (surfaced to candidates and proctors):
 *  - Bitmap checkpoints: visual-state comparison only (not process-level).
 *  - End-state verification only: no step-by-step feedback or replay.
 *  - Deterministic script-based verification is not GA until Q3 2026.
 *  - Final certification score weighting is Genesys's responsibility, not the portal's.
 */

// --- Domain types ---

export interface ScoreStep {
  readonly stepId: string;
  readonly title: string;
  readonly completed: boolean;
}

/** Per-participant Guided Journey progress as returned by the ScoreRetrievalProvider port. */
export interface ParticipantProgress {
  readonly percentComplete: number;
  readonly stepsCompleted: number;
  readonly stepsTotal: number;
  readonly steps: ScoreStep[];
}

/** Enriched score result, combining participant progress with exam attempt context. */
export interface ScoreResult {
  readonly examAttemptId: string;
  readonly experienceId: string;
  readonly percentComplete: number;
  readonly stepsCompleted: number;
  readonly stepsTotal: number;
  readonly steps: ScoreStep[];
  /** ISO 8601 timestamp of when progress was retrieved. */
  readonly retrievedAt: string;
}

/** Known limitations of CloudShare's Guided Journey scoring. Surface these in the UI. */
export const SCORING_LIMITATIONS = [
  "Scoring uses bitmap checkpoints: visual state comparison only, not process-level capture.",
  "End-state verification only — approach and intermediate steps are not assessed.",
  "Deterministic script-based verification is not generally available until Q3 2026.",
  "Final certification score weighting is determined by Genesys, not this portal.",
] as const;

// --- Port ---

export interface ScoreRetrievalProvider {
  /** Fetch per-participant progress for a CloudShare experience. Returns null if no data yet. */
  getParticipantProgress(experienceId: string): Promise<ParticipantProgress | null>;
}

// --- Use case ---

export interface RetrieveScoreDeps {
  readonly launches: LabLaunchRepository;
  readonly scoreRetriever: ScoreRetrievalProvider;
}

export interface RetrieveScoreInput {
  readonly examAttemptId: string;
}

const EMPTY_PROGRESS: ParticipantProgress = {
  percentComplete: 0,
  stepsCompleted: 0,
  stepsTotal: 0,
  steps: [],
};

export async function retrieveScore(
  deps: RetrieveScoreDeps,
  input: RetrieveScoreInput,
): Promise<ScoreResult> {
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  if (!launch) {
    throw new LabLaunchNotFoundError({ examAttemptId: input.examAttemptId });
  }

  let progress: ParticipantProgress | null;
  try {
    progress = await deps.scoreRetriever.getParticipantProgress(launch.experienceId);
  } catch (cause) {
    throw new ScoreRetrievalError("Failed to retrieve Guided Journey progress", {
      examAttemptId: input.examAttemptId,
      experienceId: launch.experienceId,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const p = progress ?? EMPTY_PROGRESS;
  return {
    examAttemptId: input.examAttemptId,
    experienceId: launch.experienceId,
    percentComplete: p.percentComplete,
    stepsCompleted: p.stepsCompleted,
    stepsTotal: p.stepsTotal,
    steps: p.steps,
    retrievedAt: new Date().toISOString(),
  };
}
