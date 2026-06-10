import type { Logger } from "@/observability/logger";
import {
  retrieveScore,
  SCORING_LIMITATIONS,
  type ScoreRetrievalProvider,
} from "@/domain/score-result";
import { LabLaunchNotFoundError, ScoreRetrievalError } from "@/domain/errors";
import type { LabLaunchRepository } from "@/domain/lab-launch";

/**
 * Framework-agnostic handler for GET /api/exam/score.
 * Accepts { examAttemptId } from query params. Returns the candidate's Guided
 * Journey ScoreResult alongside the platform's known scoring limitations.
 *
 * HTTP contract:
 *  - 400  missing examAttemptId
 *  - 404  no lab launch found for the exam attempt
 *  - 200  ScoreResult + limitations array
 *  - 502  CloudShare retrieval failed
 *  - 500  unexpected error
 */

export interface ScoreHandlerDeps {
  readonly launches: LabLaunchRepository;
  readonly scoreRetriever: ScoreRetrievalProvider;
  readonly logger: Logger;
}

export interface ScoreRequest {
  readonly query: Record<string, string | undefined>;
}

export interface ScoreResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleRetrieveScore(
  deps: ScoreHandlerDeps,
  request: ScoreRequest,
): Promise<ScoreResponse> {
  const examAttemptId = request.query.examAttemptId?.trim();
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  try {
    const result = await retrieveScore(
      { launches: deps.launches, scoreRetriever: deps.scoreRetriever },
      { examAttemptId },
    );

    return {
      status: 200,
      body: {
        examAttemptId: result.examAttemptId,
        experienceId: result.experienceId,
        percentComplete: result.percentComplete,
        stepsCompleted: result.stepsCompleted,
        stepsTotal: result.stepsTotal,
        steps: result.steps,
        retrievedAt: result.retrievedAt,
        limitations: [...SCORING_LIMITATIONS],
      },
    };
  } catch (err) {
    if (err instanceof LabLaunchNotFoundError) {
      return { status: 404, body: { error: "no lab launch found for exam attempt" } };
    }
    if (err instanceof ScoreRetrievalError) {
      deps.logger.error("score retrieval failed", {
        examAttemptId,
        error: err.message,
        ...(err.context ?? {}),
      });
      return { status: 502, body: { error: "score retrieval failed" } };
    }
    deps.logger.error("score retrieval errored", {
      examAttemptId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, body: { error: "internal error" } };
  }
}
