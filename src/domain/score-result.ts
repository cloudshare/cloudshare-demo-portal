import { LabLaunchNotFoundError, ScoreRetrievalError } from "./errors";
import type { LabLaunchRepository } from "./lab-launch";

/**
 * Guided Journey scoring domain types and the retrieveScore use case.
 * Provider-specific limitation disclaimers live in the integration layer
 * (e.g. src/integrations/cloudshare/guided-journey.ts), not here.
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

export type ExamAttemptScore =
  | (ScoreResult & {
      readonly scoreAvailable: true;
    })
  | {
      readonly examAttemptId: string;
      readonly experienceId: string;
      readonly scoreAvailable: false;
      readonly reason: "score_retrieval_disabled" | "no_guided_journey_score";
      readonly retrievedAt: string;
    };

// --- Port ---

export interface ScoreRetrievalProvider {
  /** Fetch per-participant progress for a CloudShare experience. Returns null if no data yet. */
  getParticipantProgress(
    experienceId: string,
    participantId: string,
  ): Promise<ParticipantProgress | null>;
}

// --- Use case ---

export interface RetrieveScoreDeps {
  readonly launches: LabLaunchRepository;
  readonly scoreRetriever: ScoreRetrievalProvider;
}

export interface RetrieveScoreInput {
  readonly examAttemptId: string;
}

export interface ResolveExamAttemptScoreInput {
  readonly examAttemptId: string;
  readonly experienceId: string;
  readonly participantId: string;
  readonly scoreRetrievalEnabled: boolean;
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
  if (!launch.participantId) {
    throw new ScoreRetrievalError("Failed to retrieve Guided Journey progress", {
      examAttemptId: input.examAttemptId,
      experienceId: launch.experienceId,
      cause: "missing_participant_id",
      causeMessage: "CloudShare participantId is not recorded for this lab launch",
    });
  }
  try {
    progress = await deps.scoreRetriever.getParticipantProgress(
      launch.experienceId,
      launch.participantId,
    );
  } catch (cause) {
    throw new ScoreRetrievalError("Failed to retrieve Guided Journey progress", {
      examAttemptId: input.examAttemptId,
      experienceId: launch.experienceId,
      cause,
      causeMessage: cause instanceof Error ? cause.message : String(cause),
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

export async function resolveExamAttemptScore(
  deps: {
    readonly scoreRetriever: ScoreRetrievalProvider;
    readonly now?: () => Date;
  },
  input: ResolveExamAttemptScoreInput,
): Promise<ExamAttemptScore> {
  const retrievedAt = (deps.now ?? (() => new Date()))().toISOString();

  if (!input.scoreRetrievalEnabled) {
    return {
      examAttemptId: input.examAttemptId,
      experienceId: input.experienceId,
      scoreAvailable: false,
      reason: "score_retrieval_disabled",
      retrievedAt,
    };
  }

  let progress: ParticipantProgress | null;
  try {
    progress = await deps.scoreRetriever.getParticipantProgress(
      input.experienceId,
      input.participantId,
    );
  } catch (cause) {
    throw new ScoreRetrievalError("Failed to retrieve Guided Journey progress", {
      examAttemptId: input.examAttemptId,
      experienceId: input.experienceId,
      cause,
      causeMessage: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (!progress) {
    return {
      examAttemptId: input.examAttemptId,
      experienceId: input.experienceId,
      scoreAvailable: false,
      reason: "no_guided_journey_score",
      retrievedAt,
    };
  }

  return {
    examAttemptId: input.examAttemptId,
    experienceId: input.experienceId,
    scoreAvailable: true,
    percentComplete: progress.percentComplete,
    stepsCompleted: progress.stepsCompleted,
    stepsTotal: progress.stepsTotal,
    steps: progress.steps,
    retrievedAt,
  };
}
