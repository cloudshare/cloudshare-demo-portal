import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import {
  getExamAttemptScoreRuntime,
  type ExamAttemptScoreRuntimeDeps,
  type ExamAttemptScoreRuntimeResponse,
} from "./exam-attempt-score-runtime";

export interface ScoreHandlerDeps extends ExamAttemptScoreRuntimeDeps {
  readonly attempts: ExamAttemptRepository;
}

export interface ScoreRequest {
  readonly query: Record<string, string | undefined>;
  readonly session:
    | {
        readonly userId: string;
        readonly customerId: string;
        readonly role: string;
      }
    | null;
}

export type ScoreResponse = ExamAttemptScoreRuntimeResponse;

export async function handleGetCandidateScore(
  deps: ScoreHandlerDeps,
  request: ScoreRequest,
): Promise<ScoreResponse> {
  if (!request.session || request.session.role !== "candidate") {
    return { status: 401, body: { error: "unauthorized" } };
  }

  const examAttemptId = request.query.examAttemptId?.trim();
  if (!examAttemptId) {
    return { status: 400, body: { error: "examAttemptId is required" } };
  }

  const attempt = await deps.attempts.findById(examAttemptId);
  if (
    !attempt ||
    attempt.candidateId !== request.session.userId ||
    (attempt.customerId && attempt.customerId !== request.session.customerId)
  ) {
    return { status: 403, body: { error: "forbidden" } };
  }

  return getExamAttemptScoreRuntime(deps, {
    attempt,
    customerId: request.session.customerId,
  });
}
