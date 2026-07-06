import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import {
  closeCohortExamSessionAdmission,
  retireCohortExamSession,
  CohortExamSessionValidationError,
  type CohortExamSessionRepository,
} from "@/domain/cohort-exam-session";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import { ExamNotFoundError, type ExamRepository } from "@/domain/exam-catalog";
import type { TrainingParticipant } from "@/domain/environment-correlation";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareTrainingRetirementWriter } from "@/integrations/cloudshare/cohort-experience-retirement";
import { createCloudShareTrainingParticipantReader } from "@/integrations/cloudshare/participants";
import type { Logger } from "@/observability/logger";
import type { AdminCohortExamSessionAttemptRepository } from "./admin-cohort-exam-session-detail";

export interface AdminCohortExamSessionLifecycleDeps {
  readonly exams: ExamRepository;
  readonly sessions: CohortExamSessionRepository;
  readonly attempts?: AdminCohortExamSessionAttemptRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newAuditId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface AdminCohortExamSessionLifecycleRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly examId: string;
  readonly sessionId: string;
  readonly body?: unknown;
}

export async function handleCloseCohortExamSessionAdmission(
  deps: AdminCohortExamSessionLifecycleDeps,
  request: AdminCohortExamSessionLifecycleRequest,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    const session = await findOwnedSession(deps, request.customerId, exam.id, request.sessionId);
    const closed = await closeCohortExamSessionAdmission(
      { repository: deps.sessions, now: deps.now },
      { session },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: closed.id },
      examId: exam.id,
      level: "info",
      operation: "cohort_exam_session.close_admission",
      outcome: "success",
      message: "Cohort Exam Session admission closed",
      externalIds: buildSessionExternalIds(closed),
      details: { changedFields: ["status"] },
    });
    await safeRecordAudit(deps, {
      request,
      action: "cohort_exam_session.admission_closed",
      subjectId: closed.id,
      examId: exam.id,
      details: { changedFields: ["status"] },
    });
    return {
      status: 200,
      body: {
        session: wrapSession(closed),
      },
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof CohortExamSessionValidationError) {
      return { status: 409, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handleRetireCohortExamSession(
  deps: AdminCohortExamSessionLifecycleDeps,
  request: AdminCohortExamSessionLifecycleRequest,
) {
  if (!deps.attempts || !deps.connections || !deps.cloudshare) {
    throw new Error("Cohort Exam Session retirement requires CloudShare and attempt dependencies.");
  }
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    const session = await findOwnedSession(deps, request.customerId, exam.id, request.sessionId);
    if (!session.cloudShareTrainingId || !session.cloudShareExperienceId) {
      return {
        status: 409,
        body: { error: "Only published Cohort Exam Sessions with CloudShare identifiers can be retired." },
      };
    }

    const connection = await deps.connections.findByCustomerId(request.customerId);
    if (!connection) {
      return { status: 409, body: { error: "CloudShare is not connected for this customer." } };
    }

    const client = deps.cloudshare.forConnection(connection);
    const participantReader = createCloudShareTrainingParticipantReader(client);
    const participantRead = await participantReader.readParticipants(session.cloudShareTrainingId);
    const attempts = await deps.attempts.listBySessionId(request.customerId, session.id);
    const warning = buildRetireWarning(participantRead.participants, attempts.length);

    if (warning.activeParticipantCount > 0 || warning.nonTerminalEnvironmentCount > 0) {
      const confirmed = parseBooleanFlag(request.body, "confirmInterrupt");
      if (!confirmed) {
        return {
          status: 409,
          body: {
            error: "Active participants may be interrupted by retiring this Cohort Exam Session.",
            code: "confirmation_required",
            warning,
          },
        };
      }
    }

    const retiredAt = (deps.now ?? (() => new Date()))();
    const result = await createCloudShareTrainingRetirementWriter(client).retireTrainingToEnd({
      trainingId: session.cloudShareTrainingId,
      end: retiredAt,
    });
    const retired = await retireCohortExamSession(
      { repository: deps.sessions, now: () => retiredAt },
      { session },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: retired.id },
      examId: exam.id,
      level: "info",
      operation: "cohort_exam_session.retire",
      outcome: "success",
      correlationId,
      message: "Cohort Exam Session retired",
      externalIds: buildSessionExternalIds(retired),
      request: result.request as Record<string, unknown>,
      response: result.response as Record<string, unknown>,
      details: {
        ...warning,
        confirmationRequired: warning.activeParticipantCount > 0 || warning.nonTerminalEnvironmentCount > 0,
        integrationSurface: result.integrationSurface,
      },
    });
    await safeRecordAudit(deps, {
      request,
      action: "cohort_exam_session.retired",
      subjectId: retired.id,
      examId: exam.id,
      details: warning,
    });
    return {
      status: 200,
      body: {
        session: wrapSession(retired),
        warning,
      },
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof CohortExamSessionValidationError) {
      return { status: 409, body: { error: error.message } };
    }
    if (isCloudShareError(error)) {
      const diagnostic = toCloudShareFailureDiagnostic(error);
      await safeRecordDiagnostic(deps, {
        source: "admin-exams",
        customerId: request.customerId,
        actor: request.actor ?? null,
        subject: { type: "cohort_exam_session", id: request.sessionId },
        examId: request.examId,
        level: "warn",
        operation: "cohort_exam_session.retire",
        outcome: "failure",
        correlationId,
        message: "CloudShare could not retire this Cohort Exam Session",
        ...(diagnostic.request ? { request: diagnostic.request } : {}),
        ...(diagnostic.response ? { response: diagnostic.response } : {}),
        details: diagnostic.details,
      });
      deps.logger.warn("cohort session retire failed", {
        correlationId,
        customerId: request.customerId,
        examId: request.examId,
        sessionId: request.sessionId,
        ...diagnostic.details,
      });
      return {
        status: 502,
        body: {
          error: "CloudShare could not retire this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
          correlationId,
        },
      };
    }
    throw error;
  }
}

function buildRetireWarning(
  participants: readonly TrainingParticipant[],
  portalAttemptCount: number,
) {
  let activeParticipantCount = 0;
  let nonTerminalEnvironmentCount = 0;
  for (const participant of participants) {
    const participationStatus = participant.participationStatus?.trim().toLowerCase();
    const environmentStatus = participant.environmentStatus?.trim().toLowerCase();
    if (participationStatus === "inprogress") {
      activeParticipantCount += 1;
    }
    if (environmentStatus && environmentStatus !== "archived" && environmentStatus !== "deleted") {
      nonTerminalEnvironmentCount += 1;
    }
  }
  return {
    participantCount: participants.length,
    portalAttemptCount,
    activeParticipantCount,
    nonTerminalEnvironmentCount,
  };
}

function wrapSession(session: {
  readonly id: string;
  readonly name: string;
  readonly admissionStartsAt: Date;
  readonly admissionEndsAt: Date | null;
  readonly capacity: number | null;
  readonly status: string;
  readonly cloudShareTrainingId?: string | null;
  readonly cloudShareExperienceId?: string | null;
  readonly cloudShareTeamId?: string | null;
  readonly publishedAt?: Date | null;
  readonly admissionClosedAt?: Date | null;
  readonly retiredAt?: Date | null;
  readonly lastPublishError?: string | null;
  readonly lastPublishCorrelationId?: string | null;
}) {
  return {
    session: {
      id: session.id,
      name: session.name,
      admissionStartsAt: session.admissionStartsAt.toISOString(),
      admissionEndsAt: session.admissionEndsAt?.toISOString() ?? null,
      capacity: session.capacity,
      status: session.status,
      cloudShareTrainingId: session.cloudShareTrainingId ?? null,
      cloudShareExperienceId: session.cloudShareExperienceId ?? null,
      cloudShareTeamId: session.cloudShareTeamId ?? null,
      publishedAt: session.publishedAt?.toISOString() ?? null,
      admissionClosedAt: session.admissionClosedAt?.toISOString() ?? null,
      retiredAt: session.retiredAt?.toISOString() ?? null,
      lastPublishError: session.lastPublishError ?? null,
      lastPublishCorrelationId: session.lastPublishCorrelationId ?? null,
    },
  };
}

function buildSessionExternalIds(session: {
  readonly id: string;
  readonly cloudShareTrainingId?: string | null;
  readonly cloudShareExperienceId?: string | null;
}) {
  return {
    cohortSessionId: session.id,
    ...(session.cloudShareTrainingId ? { trainingId: session.cloudShareTrainingId } : {}),
    ...(session.cloudShareExperienceId ? { experienceId: session.cloudShareExperienceId } : {}),
  };
}

async function findOwnedExam(
  deps: Pick<AdminCohortExamSessionLifecycleDeps, "exams">,
  customerId: string,
  examId: string,
) {
  const exam = await deps.exams.findById(examId);
  if (!exam || exam.customerId !== customerId) {
    throw new ExamNotFoundError(customerId, examId);
  }
  return exam;
}

async function findOwnedSession(
  deps: Pick<AdminCohortExamSessionLifecycleDeps, "sessions">,
  customerId: string,
  examId: string,
  sessionId: string,
) {
  const session = await deps.sessions.findById(sessionId);
  if (!session || session.customerId !== customerId || session.examId !== examId) {
    throw new CohortExamSessionValidationError(`Cohort Exam Session ${sessionId} was not found.`);
  }
  return session;
}

function parseBooleanFlag(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && (body as Record<string, unknown>)[key] === true;
}

function isCloudShareError(error: unknown): boolean {
  return (
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    (error instanceof Error && error.name.startsWith("CloudShare"))
  );
}

function toCloudShareFailureDiagnostic(
  error: unknown,
): {
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
  readonly details: Record<string, unknown>;
} {
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : undefined;
  return {
    request:
      context.method || context.path || context.requestHeaders || context.requestBody
        ? {
            method: context.method ?? "PUT",
            path: context.path ?? "/v4/trainings/{trainingId}",
            ...(context.requestHeaders ? { headers: context.requestHeaders } : {}),
            ...(context.requestBody !== undefined ? { body: context.requestBody } : {}),
          }
        : undefined,
    response:
      status !== undefined || context.responseHeaders || context.responseBody
        ? {
            ...(status !== undefined ? { status } : {}),
            ...(context.responseHeaders ? { headers: context.responseHeaders } : {}),
            ...(context.responseBody !== undefined ? { body: context.responseBody } : {}),
          }
        : undefined,
    details: {
      integrationSurface: context.integrationSurface ?? "cloudshare.v4.training.update",
      failureMode: inferFailureMode(error),
      ...(status !== undefined ? { responseStatus: status } : {}),
      ...(context.cause ? { cause: context.cause } : {}),
      ...(context.issues ? { issues: context.issues } : {}),
    },
  };
}

function inferFailureMode(error: unknown): string {
  if (error instanceof CloudShareRequestError || (error as { name?: unknown }).name === "CloudShareRequestError") {
    return "http_status";
  }
  if (error instanceof CloudShareTransportError || (error as { name?: unknown }).name === "CloudShareTransportError") {
    return "transport";
  }
  if (error instanceof CloudShareResponseError || (error as { name?: unknown }).name === "CloudShareResponseError") {
    return "unexpected_response";
  }
  return "cloudshare_error";
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) return;
  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("cohort session lifecycle diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeRecordAudit(
  deps: Pick<AdminCohortExamSessionLifecycleDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminCohortExamSessionLifecycleRequest;
    readonly action: string;
    readonly subjectId: string;
    readonly examId: string;
    readonly details?: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.audit) return;
  try {
    await deps.audit.write({
      id: (deps.newAuditId ?? randomUUID)(),
      customerId: input.request.customerId,
      actorType: input.request.actor?.type ?? null,
      actorId: input.request.actor?.id ?? null,
      actorEmail: input.request.actor?.email ?? null,
      action: input.action,
      subjectType: "cohort_exam_session",
      subjectId: input.subjectId,
      outcome: "success",
      examId: input.examId,
      details: input.details ?? null,
      occurredAt: (deps.now ?? (() => new Date()))(),
    });
  } catch (error) {
    deps.logger.warn("cohort session lifecycle audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
