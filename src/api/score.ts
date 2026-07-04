import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";
import {
  MAX_DIAGNOSTIC_QUERY_LIMIT,
  type DiagnosticLogRepository,
} from "@/domain/diagnostic-log";
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
  readonly scoreEvidence?: DiagnosticLogRepository;
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
  readonly diagnostics?: DiagnosticLogRepository;
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
    scoreEvidence: services.diagnostics,
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

  const persisted = await getPersistedCandidateScore(deps, {
    attempt,
    customerId: request.session.customerId,
  });
  if (persisted) {
    return persisted;
  }

  return getExamAttemptScoreRuntime(deps, {
    attempt,
    customerId: request.session.customerId,
  });
}

async function getPersistedCandidateScore(
  deps: ScoreHandlerDeps,
  request: {
    readonly attempt: NonNullable<Awaited<ReturnType<ExamAttemptRepository["findById"]>>>;
    readonly customerId: string;
  },
): Promise<ScoreResponse | null> {
  if (!deps.scoreEvidence) {
    return null;
  }

  const records = await deps.scoreEvidence.query({
    customerId: request.customerId,
    examAttemptId: request.attempt.id,
    operation: "exam_attempt.score.retrieve",
    outcome: "success",
    limit: MAX_DIAGNOSTIC_QUERY_LIMIT,
  });
  const latest = [...records]
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())[0];
  const response = latest?.response && typeof latest.response === "object"
    ? latest.response
    : null;
  if (!latest || !response || typeof response.scoreAvailable !== "boolean") {
    return null;
  }

  const exam = await deps.exams.findById(request.attempt.examId);
  if (!exam || exam.customerId !== request.customerId) {
    return null;
  }
  const launch = await deps.launches.findByExamAttemptId(request.attempt.id);
  if (!launch) {
    return null;
  }

  const base = {
    examAttemptId: request.attempt.id,
    examTitle: exam.title,
    scheduledFor: request.attempt.scheduledFor?.toISOString() ?? null,
    experienceId: asString(response.experienceId) ?? launch.experienceId,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
    retrievedAt: asString(response.retrievedAt) ?? latest.occurredAt.toISOString(),
    limitations: [...deps.limitations],
  };

  if (response.scoreAvailable === false) {
    return {
      status: 200,
      body: {
        ...base,
        scoreAvailable: false,
        reason: asScoreUnavailableReason(response.reason),
        message: scoreUnavailableMessage(response.reason),
      },
    };
  }

  return {
    status: 200,
    body: {
      ...base,
      scoreRetrievalEnabled: true,
      scoreAvailable: true,
      percentComplete: asNumber(response.percentComplete) ?? 0,
      stepsCompleted: asNumber(response.stepsCompleted) ?? 0,
      stepsTotal: asNumber(response.stepsTotal) ?? 0,
      steps: Array.isArray(response.steps) ? response.steps : [],
      exploredRate: asNumber(response.exploredRate) ?? 0,
      inProgressRate: asNumber(response.inProgressRate) ?? 0,
      notStartedRate: asNumber(response.notStartedRate) ?? 0,
      passedRate: asNumber(response.passedRate) ?? 0,
      failedRate: asNumber(response.failedRate) ?? 0,
      notInitiatedRate: asNumber(response.notInitiatedRate) ?? 0,
    },
  };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asScoreUnavailableReason(value: unknown): "score_retrieval_disabled" | "no_guided_journey_score" {
  return value === "score_retrieval_disabled" ? value : "no_guided_journey_score";
}

function scoreUnavailableMessage(reason: unknown): string {
  return reason === "score_retrieval_disabled"
    ? "Guided Journey scoring is not enabled for this Exam."
    : "No Guided Journey score is available for this Exam attempt.";
}
