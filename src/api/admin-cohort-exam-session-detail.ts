import { randomUUID } from "node:crypto";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type {
  CohortExamSessionWithInheritedContext,
  CohortExamSessionRepository,
} from "@/domain/cohort-exam-session";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { ExamNotFoundError, type ExamRepository } from "@/domain/exam-catalog";
import type { TrainingParticipant } from "@/domain/environment-correlation";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
  isCloudShareRateLimitError,
} from "@/integrations/cloudshare";
import {
  createCloudShareAggregateGuidedJourneyProvider,
  type AggregateGuidedJourneyProgress,
  type DiagnosticAggregateGuidedJourneyProvider,
} from "@/integrations/cloudshare/guided-journey";
import { createCloudShareTrainingParticipantReader } from "@/integrations/cloudshare/participants";
import type { Logger } from "@/observability/logger";
import { attachCohortExamSessionInheritedContext } from "@/domain/cohort-exam-session";
import {
  deriveCohortExamSessionMonitoringSummary,
  deriveCohortExamSessionReconciliationRows,
  getCohortExamSessionMonitoringStateContributions,
  type CohortExamSessionMonitoringStateContribution,
} from "@/domain/cohort-exam-session-monitoring";
import {
  classifyCohortMonitoringObservation,
  type CohortMonitoringObservationRepository,
} from "@/domain/cohort-monitoring-observation";

export interface AdminCohortExamSessionAttemptRecord {
  readonly id: string;
  readonly customerId: string;
  readonly candidateId: string;
  readonly candidateEmail: string;
  readonly candidateFirstName: string | null;
  readonly candidateLastName: string | null;
  readonly examId: string;
  readonly examTitle: string;
  readonly status: "scheduled" | "ready" | "in_progress" | "suspended" | "completed" | "expired";
  readonly scheduledFor: Date | null;
  readonly createdAt: Date;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
  readonly environmentId: string | null;
  readonly participantId: string | null;
}

export interface AdminCohortExamSessionAttemptRepository {
  listBySessionId(customerId: string, sessionId: string): Promise<readonly AdminCohortExamSessionAttemptRecord[]>;
}

export interface DiagnosticFilterSeed {
  readonly examAttemptId?: string;
  readonly examId?: string;
  readonly candidateEmail?: string;
  readonly operation?: string;
  readonly outcome?: "success" | "failure";
  readonly correlationId?: string;
  readonly externalId?: string;
}

export interface AdminCohortExamSessionDetailResponse {
  readonly status: number;
  readonly body:
    | {
        readonly error: string;
      }
    | {
        readonly session: CohortExamSessionWithInheritedContext;
        readonly monitoring: CohortExamSessionMonitoringView;
      };
}

export interface CohortExamSessionMonitoringView {
  readonly summary: {
    readonly activeCount: number;
    readonly inProgressCount: number;
    readonly completedCount: number;
    readonly problemCount: number;
    readonly stateObservationCount?: number;
    readonly needsAttentionCount?: number;
    readonly portalAttemptCount: number;
    readonly cloudShareParticipantCount: number;
    readonly derivedFrom: "portal_and_cloudshare";
  };
  readonly portalAttempts: readonly CohortExamSessionAttemptView[];
  readonly cloudShareParticipants: {
    readonly status: "available" | "unavailable" | "rate_limited" | "not_published";
    readonly trainingId: string | null;
    readonly readError: string | null;
    readonly correlationId: string | null;
    readonly retryAfterSeconds?: number;
    readonly participants: readonly CohortExamSessionParticipantView[];
  };
  readonly guidedJourneyAggregate: CohortExamSessionGuidedJourneyAggregateView;
  readonly diagnostics: {
    readonly session: DiagnosticFilterSeed;
    readonly cloudShareRead?: DiagnosticFilterSeed;
    readonly guidedJourneyAggregateRead?: DiagnosticFilterSeed;
  };
}

export interface CohortExamSessionGuidedJourneyAggregateView {
  readonly status: "available" | "unavailable" | "disabled" | "not_published";
  readonly experienceId: string | null;
  readonly readError: string | null;
  readonly correlationId: string | null;
  readonly progress: AggregateGuidedJourneyProgress | null;
}

export interface CohortExamSessionAttemptView {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string;
  readonly status: AdminCohortExamSessionAttemptRecord["status"];
  readonly scheduledFor: string | null;
  readonly createdAt: string;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
  readonly environmentId: string | null;
  readonly participantId: string | null;
  readonly problemReasons: readonly string[];
  readonly reconciliation?: "normal" | "unknown" | "state_observation" | "needs_attention";
  readonly summaryContributions?: readonly CohortExamSessionMonitoringStateContribution[];
  readonly diagnosticFilters: DiagnosticFilterSeed;
}

export interface CohortExamSessionParticipantView {
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly displayName: string | null;
  readonly studentId: string | null;
  readonly environmentId: string | null;
  readonly environmentStatus: string | null;
  readonly participationStatus: string | null;
  readonly firstJoinedAt: string | null;
  readonly matchedExamAttemptId: string | null;
  readonly problemReasons: readonly string[];
  readonly reconciliation?: "normal" | "unknown" | "state_observation" | "needs_attention";
  readonly summaryContributions?: readonly CohortExamSessionMonitoringStateContribution[];
  readonly diagnosticFilters: DiagnosticFilterSeed;
}

export interface AdminCohortExamSessionDetailDeps {
  readonly exams: ExamRepository;
  readonly sessions: CohortExamSessionRepository;
  readonly attempts: AdminCohortExamSessionAttemptRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly logger: Logger;
  readonly observations?: CohortMonitoringObservationRepository;
  readonly newCorrelationId?: () => string;
}

export async function handleGetAdminCohortExamSessionDetail(
  deps: AdminCohortExamSessionDetailDeps,
  request: {
    readonly customerId: string;
    readonly examId: string;
    readonly sessionId: string;
  },
): Promise<AdminCohortExamSessionDetailResponse> {
  try {
    const exam = await deps.exams.findById(request.examId);
    if (!exam || exam.customerId !== request.customerId) {
      throw new ExamNotFoundError(request.customerId, request.examId);
    }

    const session = await deps.sessions.findById(request.sessionId);
    if (!session || session.customerId !== request.customerId || session.examId !== exam.id) {
      return {
        status: 404,
        body: { error: `Cohort Exam Session ${request.sessionId} was not found.` },
      };
    }

    const sessionView = attachCohortExamSessionInheritedContext(exam, session);
    const attempts = await deps.attempts.listBySessionId(request.customerId, session.id);
    const participantReadCorrelationId = (deps.newCorrelationId ?? randomUUID)();
    const aggregateProgressCorrelationId = (deps.newCorrelationId ?? randomUUID)();
    const cloudShareRead = await readCloudShareParticipants(deps, {
      customerId: request.customerId,
      examId: exam.id,
      session: sessionView,
      correlationId: participantReadCorrelationId,
    });
    const aggregateProgress = await readCloudShareAggregateProgress(deps, {
      customerId: request.customerId,
      examId: exam.id,
      session: sessionView,
      correlationId: aggregateProgressCorrelationId,
    });

    return {
      status: 200,
      body: {
        session: sessionView,
        monitoring: await buildMonitoringView(
          deps.observations,
          request.customerId,
          sessionView,
          attempts,
          cloudShareRead,
          aggregateProgress,
          participantReadCorrelationId,
          aggregateProgressCorrelationId,
        ),
      },
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

async function readCloudShareAggregateProgress(
  deps: AdminCohortExamSessionDetailDeps,
  input: {
    readonly customerId: string;
    readonly examId: string;
    readonly session: CohortExamSessionWithInheritedContext;
    readonly correlationId: string;
  },
): Promise<CohortExamSessionGuidedJourneyAggregateView> {
  if (!input.session.inheritedContext.scoreRetrievalEnabled) {
    return {
      status: "disabled",
      experienceId: input.session.session.cloudShareExperienceId ?? null,
      readError: null,
      correlationId: null,
      progress: null,
    };
  }

  const experienceId = input.session.session.cloudShareExperienceId?.trim() ?? "";
  if (!experienceId || !deps.connections || !deps.cloudshare) {
    return {
      status: "not_published",
      experienceId: input.session.session.cloudShareExperienceId ?? null,
      readError: null,
      correlationId: null,
      progress: null,
    };
  }

  const connection = await deps.connections.findByCustomerId(input.customerId);
  if (!connection) {
    await deps.diagnostics?.record({
      source: "admin-exams",
      level: "warn",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
      outcome: "failure",
      customerId: input.customerId,
      examId: input.examId,
      correlationId: input.correlationId,
      subject: { type: "cohort_exam_session", id: input.session.session.id },
      message: "CloudShare aggregate Guided Journey read could not start because no CloudShare Connection is saved",
      externalIds: { experienceId },
      details: {
        integrationSurface: "cloudshare.connection",
        failureMode: "missing_connection",
        experienceId,
      },
    });
    return {
      status: "unavailable",
      experienceId,
      readError: "Aggregate Guided Journey progress is unavailable for this Cohort Exam Session / CloudShare Experience.",
      correlationId: input.correlationId,
      progress: null,
    };
  }

  const provider = createCloudShareAggregateGuidedJourneyProvider(
    deps.cloudshare.forConnection(connection),
  ) as DiagnosticAggregateGuidedJourneyProvider;

  try {
    const result = await provider.getAggregateProgressForDiagnostics(experienceId);
    if (!result.progress) {
      await deps.diagnostics?.record({
        source: "admin-exams",
        level: "warn",
        operation: "cohort_exam_session.guided_journey_aggregate.read",
        outcome: "failure",
        customerId: input.customerId,
        examId: input.examId,
        correlationId: input.correlationId,
        subject: { type: "cohort_exam_session", id: input.session.session.id },
        message: "CloudShare aggregate Guided Journey progress is unavailable for this Cohort Exam Session / CloudShare Experience",
        externalIds: { experienceId },
        request: result.request as unknown as Record<string, unknown>,
        ...(result.response ? { response: result.response as unknown as Record<string, unknown> } : {}),
        details: {
          integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
          failureMode: "not_available",
        },
      });
      return {
        status: "unavailable",
        experienceId,
        readError: "Aggregate Guided Journey progress is unavailable for this Cohort Exam Session / CloudShare Experience.",
        correlationId: input.correlationId,
        progress: null,
      };
    }

    await deps.diagnostics?.record({
      source: "admin-exams",
      level: "info",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
      outcome: "success",
      customerId: input.customerId,
      examId: input.examId,
      correlationId: input.correlationId,
      subject: { type: "cohort_exam_session", id: input.session.session.id },
      message: "CloudShare aggregate Guided Journey progress read for Cohort Exam Session detail",
      externalIds: { experienceId },
      request: result.request as unknown as Record<string, unknown>,
      ...(result.response ? { response: result.response as unknown as Record<string, unknown> } : {}),
      details: {
        integrationSurface: "cloudshare.v4.guided_journey.progress.aggregate",
        sectionCount: result.progress.aggSectionStatuses.length,
      },
    });
    return {
      status: "available",
      experienceId,
      readError: null,
      correlationId: input.correlationId,
      progress: result.progress,
    };
  } catch (error) {
    const diagnostic = toCloudShareAggregateReadFailureDiagnostic(error, experienceId);
    await deps.diagnostics?.record({
      source: "admin-exams",
      level: "warn",
      operation: "cohort_exam_session.guided_journey_aggregate.read",
      outcome: "failure",
      customerId: input.customerId,
      examId: input.examId,
      correlationId: input.correlationId,
      subject: { type: "cohort_exam_session", id: input.session.session.id },
      message: "CloudShare aggregate Guided Journey progress read failed for Cohort Exam Session detail",
      externalIds: { experienceId },
      ...(diagnostic.request ? { request: diagnostic.request } : {}),
      ...(diagnostic.response ? { response: diagnostic.response } : {}),
      details: diagnostic.details,
    });
    deps.logger.warn("cohort session aggregate Guided Journey read failed", {
      customerId: input.customerId,
      examId: input.examId,
      sessionId: input.session.session.id,
      correlationId: input.correlationId,
      ...diagnostic.details,
    });
    return {
      status: "unavailable",
      experienceId,
      readError: "Aggregate Guided Journey progress is unavailable for this Cohort Exam Session / CloudShare Experience.",
      correlationId: input.correlationId,
      progress: null,
    };
  }
}

async function readCloudShareParticipants(
  deps: AdminCohortExamSessionDetailDeps,
  input: {
    readonly customerId: string;
    readonly examId: string;
    readonly session: CohortExamSessionWithInheritedContext;
    readonly correlationId: string;
  },
): Promise<{
  readonly status: "available" | "unavailable" | "rate_limited" | "not_published";
  readonly participants: readonly TrainingParticipant[];
  readonly readError: string | null;
  readonly correlationId: string | null;
  readonly retryAfterSeconds?: number;
}> {
  const trainingId = input.session.session.cloudShareTrainingId?.trim() ?? "";
  const experienceId = input.session.session.cloudShareExperienceId?.trim() ?? "";
  if (!trainingId || !deps.connections || !deps.cloudshare) {
    return {
      status: "not_published",
      participants: [],
      readError: null,
      correlationId: null,
    };
  }

  const connection = await deps.connections.findByCustomerId(input.customerId);
  if (!connection) {
    await deps.diagnostics?.record({
      source: "admin-exams",
      level: "warn",
      operation: "cohort_exam_session.monitor.read_participants",
      outcome: "failure",
      customerId: input.customerId,
      examId: input.examId,
      correlationId: input.correlationId,
      subject: { type: "cohort_exam_session", id: input.session.session.id },
      message: "CloudShare participant read could not start because no CloudShare Connection is saved",
      externalIds: {
        trainingId,
        ...(experienceId ? { experienceId } : {}),
      },
      details: {
        integrationSurface: "cloudshare.connection",
        failureMode: "missing_connection",
        trainingId,
        ...(experienceId ? { experienceId } : {}),
      },
    });
    return {
      status: "unavailable",
      participants: [],
      readError: "CloudShare participant read failed for this Cohort Exam Session.",
      correlationId: input.correlationId,
    };
  }

  const reader = createCloudShareTrainingParticipantReader(deps.cloudshare.forConnection(connection));

  try {
    const result = await reader.readParticipants(trainingId);
    await deps.diagnostics?.record({
      source: "admin-exams",
      level: "info",
      operation: "cohort_exam_session.monitor.read_participants",
      outcome: "success",
      customerId: input.customerId,
      examId: input.examId,
      correlationId: input.correlationId,
      subject: { type: "cohort_exam_session", id: input.session.session.id },
      message: "Fetched CloudShare participants for session monitoring",
      externalIds: {
        trainingId,
        ...(experienceId ? { experienceId } : {}),
      },
      request: result.request as Record<string, unknown>,
      response: result.response as Record<string, unknown>,
      details: {
        integrationSurface: result.integrationSurface,
        participantCount: result.participants.length,
      },
    });
    return {
      status: "available",
      participants: result.participants,
      readError: null,
      correlationId: input.correlationId,
    };
  } catch (error) {
    const diagnostic = toCloudShareReadFailureDiagnostic(error, trainingId, experienceId);
    await deps.diagnostics?.record({
      source: "admin-exams",
      level: "warn",
      operation: "cohort_exam_session.monitor.read_participants",
      outcome: "failure",
      customerId: input.customerId,
      examId: input.examId,
      correlationId: input.correlationId,
      subject: { type: "cohort_exam_session", id: input.session.session.id },
      message: "Could not fetch CloudShare participants for session monitoring",
      externalIds: {
        trainingId,
        ...(experienceId ? { experienceId } : {}),
      },
      ...(diagnostic.request ? { request: diagnostic.request } : {}),
      ...(diagnostic.response ? { response: diagnostic.response } : {}),
      details: diagnostic.details,
    });
    deps.logger.warn("cohort session participant read failed", {
      customerId: input.customerId,
      examId: input.examId,
      sessionId: input.session.session.id,
      correlationId: input.correlationId,
      ...diagnostic.details,
    });
    const rateLimited = isCloudShareRateLimitError(error);
    return {
      status: rateLimited ? "rate_limited" : "unavailable",
      participants: [],
      readError: rateLimited
        ? "CloudShare rate limited the participant roster refresh for this Cohort Exam Session."
        : "CloudShare participant read failed for this Cohort Exam Session.",
      correlationId: input.correlationId,
      ...(rateLimited && typeof error.retryAfterSeconds === "number"
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    };
  }
}

async function buildMonitoringView(
  observations: CohortMonitoringObservationRepository | undefined,
  customerId: string,
  session: CohortExamSessionWithInheritedContext,
  attempts: readonly AdminCohortExamSessionAttemptRecord[],
  cloudShareRead: {
    readonly status: "available" | "unavailable" | "rate_limited" | "not_published";
    readonly participants: readonly TrainingParticipant[];
    readonly readError: string | null;
    readonly correlationId: string | null;
    readonly retryAfterSeconds?: number;
  },
  aggregateProgress: CohortExamSessionGuidedJourneyAggregateView,
  participantReadCorrelationId: string,
  aggregateProgressCorrelationId: string,
): Promise<CohortExamSessionMonitoringView> {
  const attemptsByEmail = new Map<string, AdminCohortExamSessionAttemptRecord>();
  const attemptsById = new Map<string, AdminCohortExamSessionAttemptRecord>();
  const attemptsByCandidateId = new Map<string, AdminCohortExamSessionAttemptRecord>();
  for (const attempt of attempts) {
    attemptsByEmail.set(attempt.candidateEmail.trim().toLowerCase(), attempt);
    attemptsById.set(attempt.id, attempt);
    attemptsByCandidateId.set(attempt.candidateId, attempt);
  }

  const portalAttemptsWithoutProblems = attempts.map((attempt) => ({
    id: attempt.id,
    candidateId: attempt.candidateId,
    candidateName: formatCandidateName(attempt.candidateFirstName, attempt.candidateLastName, attempt.candidateEmail),
    candidateEmail: attempt.candidateEmail,
    status: attempt.status,
    scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
    createdAt: attempt.createdAt.toISOString(),
    trainingId: attempt.trainingId,
    experienceId: attempt.experienceId,
    environmentExternalId: attempt.environmentExternalId,
    environmentId: attempt.environmentId,
    participantId: attempt.participantId,
    diagnosticFilters: { examAttemptId: attempt.id },
  }));

  const cloudShareParticipantsWithoutProblems = cloudShareRead.participants.map((participant) => {
    const matchedAttempt =
      resolveMatchedAttempt(
        participant,
        session.session.id,
        attemptsById,
        attemptsByCandidateId,
        attemptsByEmail,
      ) ?? null;
    return {
      email: participant.email,
      firstName: participant.firstName ?? null,
      lastName: participant.lastName ?? null,
      displayName: participant.displayName ?? null,
      studentId: participant.studentId ?? null,
      environmentId: participant.environmentId ?? null,
      environmentStatus: participant.environmentStatus ?? null,
      participationStatus: participant.participationStatus ?? null,
      firstJoinedAt: participant.firstJoinedAt ?? null,
      matchedExamAttemptId: matchedAttempt?.id ?? null,
      diagnosticFilters: {
        ...(matchedAttempt ? { examAttemptId: matchedAttempt.id } : {}),
        candidateEmail: participant.email,
        ...(participant.environmentId ? { externalId: participant.environmentId } : {}),
      },
    };
  });

  const derivedReconciliationRows = deriveCohortExamSessionReconciliationRows(
    portalAttemptsWithoutProblems,
    cloudShareParticipantsWithoutProblems,
  ).map((row) =>
    cloudShareRead.status === "rate_limited"
      ? { ...row, problemReasons: [] }
      : row,
  );
  // A throttled read contains no current CloudShare participant state. Do not
  // turn that absence into a portal/CloudShare contradiction or reset a prior
  // observation: this response is incomplete, not an empty participant list.
  const reconciliationRows =
    cloudShareRead.status === "rate_limited"
      ? derivedReconciliationRows.map((row) => ({ ...row, problemReasons: [] }))
      : derivedReconciliationRows;
  const portalProblemsById = new Map<string, readonly string[]>();
  const cloudProblemsByParticipantKey = new Map<string, readonly string[]>();
  const reconciliationByRowKey = new Map<string, "normal" | "unknown" | "state_observation" | "needs_attention">();
  const summaryContributionsByRowKey = new Map<string, readonly CohortExamSessionMonitoringStateContribution[]>();
  for (const row of reconciliationRows) {
    const rowKey = row.portal ? `attempt:${row.portal.id}` : `participant:${row.cloud?.email.trim().toLowerCase() ?? "unknown"}`;
    // Record normal rows too. A normal read resets a prior mismatch, so the
    // next mismatch begins a fresh two-consecutive-read grace period.
    const observation = !observations || cloudShareRead.status === "rate_limited"
      ? null
      : await observations.record({
          customerId,
          cohortSessionId: session.session.id,
          rowKey,
          signature: row.problemReasons.join("\n"),
          observedAt: new Date(),
        });
    reconciliationByRowKey.set(
      rowKey,
      cloudShareRead.status === "rate_limited"
        ? "unknown"
        : row.problemReasons.length === 0
          ? "normal"
          : classifyCohortMonitoringObservation(observation),
    );
    summaryContributionsByRowKey.set(rowKey, getCohortExamSessionMonitoringStateContributions(row));
    if (row.portal) {
      portalProblemsById.set(row.portal.id, row.problemReasons);
    }
    if (row.cloud) {
      cloudProblemsByParticipantKey.set(getCloudParticipantKey(row.cloud), row.problemReasons);
    }
  }

  const portalAttempts = portalAttemptsWithoutProblems.map((attempt) => ({
    ...attempt,
    problemReasons: portalProblemsById.get(attempt.id) ?? [],
    reconciliation: reconciliationByRowKey.get(`attempt:${attempt.id}`) ?? "normal",
    summaryContributions: summaryContributionsByRowKey.get(`attempt:${attempt.id}`) ?? [],
  }));

  const cloudShareParticipants = cloudShareParticipantsWithoutProblems.map((participant) => ({
    ...participant,
    problemReasons: cloudProblemsByParticipantKey.get(getCloudParticipantKey(participant)) ?? [],
    reconciliation:
      reconciliationByRowKey.get(
        participant.matchedExamAttemptId
          ? `attempt:${participant.matchedExamAttemptId}`
          : `participant:${participant.email.trim().toLowerCase()}`,
      ) ?? "normal",
    summaryContributions:
      summaryContributionsByRowKey.get(
        participant.matchedExamAttemptId
          ? `attempt:${participant.matchedExamAttemptId}`
          : `participant:${participant.email.trim().toLowerCase()}`,
      ) ?? [],
  }));

  const rawSummary = deriveCohortExamSessionMonitoringSummary(reconciliationRows, cloudShareRead.status);
  if (!observations) {
    return buildLegacyMonitoringView(rawSummary, portalAttempts, cloudShareParticipants, session, cloudShareRead, aggregateProgress, participantReadCorrelationId, aggregateProgressCorrelationId);
  }
  const reconciliationStates = [...reconciliationByRowKey.values()];
  const needsAttentionCount =
    (cloudShareRead.status === "unavailable" ? 1 : 0) +
    reconciliationStates.filter((state) => state === "needs_attention").length;
  const stateObservationCount = reconciliationStates.filter((state) => state === "state_observation").length;
  const summary = {
    ...rawSummary,
    problemCount: needsAttentionCount,
    needsAttentionCount,
    stateObservationCount,
  };
  return {
    summary,
    portalAttempts,
    cloudShareParticipants: {
      status: cloudShareRead.status,
      trainingId: session.session.cloudShareTrainingId ?? null,
      readError: cloudShareRead.readError,
      correlationId: cloudShareRead.correlationId,
      ...(cloudShareRead.retryAfterSeconds !== undefined ? { retryAfterSeconds: cloudShareRead.retryAfterSeconds } : {}),
      participants: cloudShareParticipants,
    },
    guidedJourneyAggregate: aggregateProgress,
    diagnostics: {
      session: {
        examId: session.session.examId,
        ...(session.session.cloudShareTrainingId ? { externalId: session.session.cloudShareTrainingId } : {}),
      },
      ...(cloudShareRead.status !== "not_published"
        ? {
            cloudShareRead: {
              correlationId: participantReadCorrelationId,
              operation: "cohort_exam_session.monitor.read_participants",
            },
          }
        : {}),
      ...(aggregateProgress.status !== "disabled" && aggregateProgress.status !== "not_published"
        ? {
            guidedJourneyAggregateRead: {
              correlationId: aggregateProgressCorrelationId,
              operation: "cohort_exam_session.guided_journey_aggregate.read",
            },
          }
        : {}),
    },
  };
}

function buildLegacyMonitoringView(
  summary: ReturnType<typeof deriveCohortExamSessionMonitoringSummary>,
  portalAttempts: readonly CohortExamSessionAttemptView[],
  cloudShareParticipants: readonly CohortExamSessionParticipantView[],
  session: CohortExamSessionWithInheritedContext,
  cloudShareRead: { readonly status: "available" | "unavailable" | "rate_limited" | "not_published"; readonly readError: string | null; readonly correlationId: string | null; readonly retryAfterSeconds?: number },
  aggregateProgress: CohortExamSessionGuidedJourneyAggregateView,
  participantReadCorrelationId: string,
  aggregateProgressCorrelationId: string,
): CohortExamSessionMonitoringView {
  return {
    summary,
    portalAttempts,
    cloudShareParticipants: { status: cloudShareRead.status, trainingId: session.session.cloudShareTrainingId ?? null, readError: cloudShareRead.readError, correlationId: cloudShareRead.correlationId, ...(cloudShareRead.retryAfterSeconds !== undefined ? { retryAfterSeconds: cloudShareRead.retryAfterSeconds } : {}), participants: cloudShareParticipants },
    guidedJourneyAggregate: aggregateProgress,
    diagnostics: {
      session: { examId: session.session.examId, ...(session.session.cloudShareTrainingId ? { externalId: session.session.cloudShareTrainingId } : {}) },
      ...(cloudShareRead.status !== "not_published" ? { cloudShareRead: { correlationId: participantReadCorrelationId, operation: "cohort_exam_session.monitor.read_participants" } } : {}),
      ...(aggregateProgress.status !== "disabled" && aggregateProgress.status !== "not_published" ? { guidedJourneyAggregateRead: { correlationId: aggregateProgressCorrelationId, operation: "cohort_exam_session.guided_journey_aggregate.read" } } : {}),
    },
  };
}

function resolveMatchedAttempt(
  participant: TrainingParticipant,
  cohortSessionId: string,
  attemptsById: ReadonlyMap<string, AdminCohortExamSessionAttemptRecord>,
  attemptsByCandidateId: ReadonlyMap<string, AdminCohortExamSessionAttemptRecord>,
  attemptsByEmail: ReadonlyMap<string, AdminCohortExamSessionAttemptRecord>,
): AdminCohortExamSessionAttemptRecord | null {
  const explicitAttemptId = participant.certalisExamAttemptId?.trim();
  if (explicitAttemptId) {
    const matchedByAttemptId = attemptsById.get(explicitAttemptId);
    if (matchedByAttemptId) {
      return matchedByAttemptId;
    }
  }

  const explicitCandidateId = participant.certalisCandidateId?.trim();
  const explicitCohortSessionId = participant.certalisCohortSessionId?.trim();
  if (
    explicitCandidateId &&
    explicitCohortSessionId &&
    explicitCohortSessionId === cohortSessionId
  ) {
    const matchedByCandidateId = attemptsByCandidateId.get(explicitCandidateId);
    if (matchedByCandidateId) {
      return matchedByCandidateId;
    }
  }

  return attemptsByEmail.get(participant.email.trim().toLowerCase()) ?? null;
}

function getCloudParticipantKey(participant: {
  readonly email: string;
  readonly matchedExamAttemptId: string | null;
}): string {
  return participant.matchedExamAttemptId
    ? `attempt:${participant.matchedExamAttemptId}`
    : `email:${participant.email.trim().toLowerCase()}`;
}

function formatCandidateName(
  firstName: string | null,
  lastName: string | null,
  email: string,
): string {
  const fullName = `${firstName?.trim() ?? ""} ${lastName?.trim() ?? ""}`.trim();
  return fullName || email;
}

function toCloudShareReadFailureDiagnostic(
  error: unknown,
  trainingId: string,
  experienceId: string,
): {
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
  readonly details: Record<string, unknown>;
} {
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status)
      : undefined;

  return {
    request:
      context.method || context.path || context.requestHeaders || context.requestBody
        ? {
            method: context.method ?? "GET",
            path: context.path ?? `/v4/trainings/${trainingId}/students`,
            ...(context.requestHeaders ? { headers: context.requestHeaders } : {}),
            ...(context.requestBody !== undefined ? { body: context.requestBody } : {}),
          }
        : {
            method: "GET",
            path: `/v4/trainings/${trainingId}/students`,
          },
    response:
      status !== undefined || context.responseHeaders || context.responseBody
        ? {
            ...(status !== undefined ? { status } : {}),
            ...(context.responseHeaders ? { headers: context.responseHeaders } : {}),
            ...(context.responseBody !== undefined ? { body: context.responseBody } : {}),
          }
        : undefined,
    details: {
      integrationSurface: context.integrationSurface ?? "cloudshare.v4.training.participant",
      failureMode: inferFailureMode(error),
      ...(status !== undefined ? { responseStatus: status } : {}),
      ...(context.cause ? { cause: context.cause } : {}),
      ...(context.issues ? { issues: context.issues } : {}),
      trainingId,
      ...(experienceId ? { experienceId } : {}),
    },
  };
}

function inferFailureMode(error: unknown): string {
  if (isCloudShareRateLimitError(error)) {
    return "rate_limit";
  }
  if (error instanceof CloudShareRequestError) {
    return "http_status";
  }
  if (error instanceof CloudShareTransportError) {
    return "transport";
  }
  if (error instanceof CloudShareResponseError) {
    return "unexpected_response";
  }
  return "unknown";
}

function toCloudShareAggregateReadFailureDiagnostic(
  error: unknown,
  experienceId: string,
): {
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
  readonly details: Record<string, unknown>;
} {
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? ((error as { status: number }).status)
      : undefined;

  return {
    request:
      context.method || context.path || context.requestHeaders || context.requestBody
        ? {
            method: context.method ?? "GET",
            path: context.path ?? `/v4/guided-journey/progress/${experienceId}`,
            ...(context.requestHeaders ? { headers: context.requestHeaders } : {}),
            ...(context.requestBody !== undefined ? { body: context.requestBody } : {}),
          }
        : {
            method: "GET",
            path: `/v4/guided-journey/progress/${experienceId}`,
          },
    response:
      status !== undefined || context.responseHeaders || context.responseBody
        ? {
            ...(status !== undefined ? { status } : {}),
            ...(context.responseHeaders ? { headers: context.responseHeaders } : {}),
            ...(context.responseBody !== undefined ? { body: context.responseBody } : {}),
          }
        : undefined,
    details: {
      integrationSurface: context.integrationSurface ?? "cloudshare.v4.guided_journey.progress.aggregate",
      failureMode: inferFailureMode(error),
      ...(status !== undefined ? { responseStatus: status } : {}),
      ...(context.cause ? { cause: context.cause } : {}),
      ...(context.issues ? { issues: context.issues } : {}),
      experienceId,
    },
  };
}
