import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";
import {
  createCloudShareGuidedJourneyProvider,
  SCORING_LIMITATIONS,
} from "@/integrations/cloudshare/guided-journey";
import { createCloudShareParticipantLister } from "@/integrations/cloudshare/participants";
import {
  getExamAttemptScoreRuntime,
  type ExamAttemptScoreRuntimeDeps,
  type ExamAttemptScoreRuntimeResponse,
} from "./exam-attempt-score-runtime";

export interface ScoreHandlerDeps extends ExamAttemptScoreRuntimeDeps {
  readonly attempts: ExamAttemptRepository;
}

export interface CandidateScoreServices {
  readonly examAttempts: ScoreHandlerDeps["attempts"];
  readonly exams: ScoreHandlerDeps["exams"];
  readonly labLaunches: ScoreHandlerDeps["launches"];
  readonly audit: ScoreHandlerDeps["audit"];
  readonly cloudshareConnections: ScoreHandlerDeps["connections"];
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly logger: ScoreHandlerDeps["logger"];
  readonly diagnosticRecorder: ScoreHandlerDeps["diagnostics"];
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

export function buildCandidateScoreDeps(
  services: CandidateScoreServices,
): ScoreHandlerDeps {
  return {
    attempts: services.examAttempts,
    exams: services.exams,
    launches: services.labLaunches,
    audit: services.audit,
    connections: services.cloudshareConnections,
    createScoreRetriever: (connection) =>
      createCloudShareGuidedJourneyProvider(
        services.cloudshareClientFactory.forConnection(connection),
      ),
    createParticipantLister: (connection) =>
      createCloudShareParticipantLister(
        services.cloudshareClientFactory.forConnection(connection),
      ),
    logger: services.logger,
    limitations: SCORING_LIMITATIONS,
    diagnostics: services.diagnosticRecorder,
  };
}

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
