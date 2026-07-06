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
} from "@/integrations/cloudshare";
import {
  createCloudShareAggregateGuidedJourneyProvider,
  type AggregateGuidedJourneyProgress,
  type DiagnosticAggregateGuidedJourneyProvider,
} from "@/integrations/cloudshare/guided-journey";
import { createCloudShareTrainingParticipantReader } from "@/integrations/cloudshare/participants";
import type { Logger } from "@/observability/logger";
import { attachCohortExamSessionInheritedContext } from "@/domain/cohort-exam-session";

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
    readonly portalAttemptCount: number;
    readonly cloudShareParticipantCount: number;
    readonly derivedFrom: "portal_and_cloudshare";
  };
  readonly portalAttempts: readonly CohortExamSessionAttemptView[];
  readonly cloudShareParticipants: {
    readonly status: "available" | "unavailable" | "not_published";
    readonly trainingId: string | null;
    readonly readError: string | null;
    readonly correlationId: string | null;
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
        monitoring: buildMonitoringView(
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
  readonly status: "available" | "unavailable" | "not_published";
  readonly participants: readonly TrainingParticipant[];
  readonly readError: string | null;
  readonly correlationId: string | null;
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
      message: "CloudShare participants read for Cohort Exam Session monitoring",
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
      message: "CloudShare participant read failed for Cohort Exam Session monitoring",
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
    return {
      status: "unavailable",
      participants: [],
      readError: "CloudShare participant read failed for this Cohort Exam Session.",
      correlationId: input.correlationId,
    };
  }
}

function buildMonitoringView(
  session: CohortExamSessionWithInheritedContext,
  attempts: readonly AdminCohortExamSessionAttemptRecord[],
  cloudShareRead: {
    readonly status: "available" | "unavailable" | "not_published";
    readonly participants: readonly TrainingParticipant[];
    readonly readError: string | null;
    readonly correlationId: string | null;
  },
  aggregateProgress: CohortExamSessionGuidedJourneyAggregateView,
  participantReadCorrelationId: string,
  aggregateProgressCorrelationId: string,
): CohortExamSessionMonitoringView {
  const attemptsByEmail = new Map<string, AdminCohortExamSessionAttemptRecord>();
  const attemptsById = new Map<string, AdminCohortExamSessionAttemptRecord>();
  const attemptsByCandidateId = new Map<string, AdminCohortExamSessionAttemptRecord>();
  for (const attempt of attempts) {
    attemptsByEmail.set(attempt.candidateEmail.trim().toLowerCase(), attempt);
    attemptsById.set(attempt.id, attempt);
    attemptsByCandidateId.set(attempt.candidateId, attempt);
  }

  const portalAttempts = attempts.map((attempt) => ({
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

  const cloudShareParticipants = cloudShareRead.participants.map((participant) => {
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

  const summary = deriveSummary(portalAttempts, cloudShareParticipants, cloudShareRead.status);
  return {
    summary,
    portalAttempts,
    cloudShareParticipants: {
      status: cloudShareRead.status,
      trainingId: session.session.cloudShareTrainingId ?? null,
      readError: cloudShareRead.readError,
      correlationId: cloudShareRead.correlationId,
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

function deriveSummary(
  portalAttempts: readonly CohortExamSessionAttemptView[],
  participants: readonly CohortExamSessionParticipantView[],
  cloudShareStatus: "available" | "unavailable" | "not_published",
): CohortExamSessionMonitoringView["summary"] {
  const rowsByEmail = new Map<
    string,
    {
      portal?: CohortExamSessionAttemptView;
      cloud?: CohortExamSessionParticipantView;
    }
  >();

  for (const attempt of portalAttempts) {
    const key = attempt.candidateEmail.trim().toLowerCase();
    rowsByEmail.set(key, { ...(rowsByEmail.get(key) ?? {}), portal: attempt });
  }
  for (const participant of participants) {
    const key = participant.email.trim().toLowerCase();
    rowsByEmail.set(key, { ...(rowsByEmail.get(key) ?? {}), cloud: participant });
  }

  let activeCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;
  let problemCount = cloudShareStatus === "unavailable" ? 1 : 0;

  for (const row of rowsByEmail.values()) {
    const portalActive = isPortalActive(row.portal?.status);
    const cloudActive = isCloudActive(row.cloud);
    const portalCompleted = isPortalCompleted(row.portal?.status);
    const cloudCompleted = isCloudCompleted(row.cloud);
    const portalInProgress = row.portal?.status === "in_progress";
    const cloudInProgress = isCloudInProgress(row.cloud);

    if (portalActive || cloudActive) activeCount += 1;
    if (portalInProgress || cloudInProgress) inProgressCount += 1;
    if (portalCompleted || cloudCompleted) completedCount += 1;
    if (isProblemRow(row.portal, row.cloud)) problemCount += 1;
  }

  return {
    activeCount,
    inProgressCount,
    completedCount,
    problemCount,
    portalAttemptCount: portalAttempts.length,
    cloudShareParticipantCount: participants.length,
    derivedFrom: "portal_and_cloudshare",
  };
}

function isPortalActive(status: CohortExamSessionAttemptView["status"] | undefined): boolean {
  return status === "scheduled" || status === "ready" || status === "in_progress" || status === "suspended";
}

function isPortalCompleted(status: CohortExamSessionAttemptView["status"] | undefined): boolean {
  return status === "completed" || status === "expired";
}

function isCloudActive(participant: CohortExamSessionParticipantView | undefined): boolean {
  if (!participant) {
    return false;
  }
  if (isCloudProblemParticipant(participant)) {
    return false;
  }
  if (isCloudInProgress(participant)) {
    return true;
  }
  const status = participant.participationStatus?.trim().toLowerCase();
  return status === "pending" || status === "registered" || status === "assigned";
}

function isCloudInProgress(participant: CohortExamSessionParticipantView | undefined): boolean {
  if (!participant) {
    return false;
  }
  if (isCloudProblemParticipant(participant)) {
    return false;
  }
  const participationStatus = participant.participationStatus?.trim().toLowerCase();
  if (participationStatus === "inprogress") {
    return true;
  }
  const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
  return Boolean(environmentStatus && isNormalActiveEnvironmentStatus(environmentStatus));
}

function isCloudCompleted(participant: CohortExamSessionParticipantView | undefined): boolean {
  if (!participant) {
    return false;
  }
  const participationStatus = participant.participationStatus?.trim().toLowerCase();
  const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
  return participationStatus === "completed" || Boolean(environmentStatus && isTerminalEnvironmentStatus(environmentStatus));
}

function isTerminalEnvironmentStatus(status: string): boolean {
  return status === "archived" || status === "deleted";
}

function isNormalActiveEnvironmentStatus(status: string): boolean {
  return (
    status === "ready" ||
    status === "running" ||
    status === "suspended" ||
    status === "starting" ||
    status === "provisioning" ||
    status === "resuming" ||
    status === "stopping"
  );
}

function isCloudProblemParticipant(participant: CohortExamSessionParticipantView | undefined): boolean {
  if (!participant) {
    return false;
  }
  const participationStatus = participant.participationStatus?.trim().toLowerCase();
  if (
    participationStatus === "failed" ||
    participationStatus === "error" ||
    participationStatus === "aborted" ||
    participationStatus === "denied"
  ) {
    return true;
  }
  const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
  if (!environmentStatus) {
    return false;
  }
  if (isTerminalEnvironmentStatus(environmentStatus) || isNormalActiveEnvironmentStatus(environmentStatus)) {
    return false;
  }
  return true;
}

function isProblemRow(
  portal: CohortExamSessionAttemptView | undefined,
  cloud: CohortExamSessionParticipantView | undefined,
): boolean {
  if (portal && !cloud && isPortalActive(portal.status)) {
    return true;
  }
  if (cloud && !portal) {
    return true;
  }
  if (!portal || !cloud) {
    return false;
  }

  if (isCloudProblemParticipant(cloud)) {
    return true;
  }
  if (isPortalActive(portal.status) && isCloudCompleted(cloud)) {
    return true;
  }
  if (isPortalCompleted(portal.status) && isCloudActive(cloud)) {
    return true;
  }
  return false;
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
