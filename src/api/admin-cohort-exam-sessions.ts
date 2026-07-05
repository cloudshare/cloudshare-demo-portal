import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import {
  attachCohortExamSessionInheritedContext,
  CohortExamSessionValidationError,
  createDraftCohortExamSession,
  markCohortExamSessionPublished,
  recordCohortExamSessionPublishFailure,
  type CohortExamSessionRepository,
} from "@/domain/cohort-exam-session";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  ExamNotFoundError,
  isCohortExamSessionDeliveryAvailable,
  type ExamRepository,
} from "@/domain/exam-catalog";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareOnDemandExperienceCreator } from "@/integrations/cloudshare/cohort-experiences";
import type { Logger } from "@/observability/logger";

export interface AdminCohortExamSessionDeps {
  readonly exams: ExamRepository;
  readonly sessions: CohortExamSessionRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newAuditId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface AdminCohortExamSessionServices {
  readonly exams: ExamRepository;
  readonly cohortExamSessions: CohortExamSessionRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly cloudshareConnections?: CloudShareConnectionRepository;
  readonly cloudshareClientFactory?: CloudShareClientFactory;
  readonly logger: Logger;
}

export interface AdminCohortExamSessionRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly examId: string;
  readonly body?: unknown;
}

export interface AdminCohortExamSessionDetailRequest {
  readonly customerId: string;
  readonly examId: string;
  readonly sessionId: string;
  readonly actor?: DiagnosticActor | null;
}

export function buildAdminCohortExamSessionDeps(
  services: AdminCohortExamSessionServices,
): AdminCohortExamSessionDeps {
  return {
    exams: services.exams,
    sessions: services.cohortExamSessions,
    diagnostics: services.diagnosticRecorder,
    ...(services.audit ? { audit: services.audit } : {}),
    ...(services.cloudshareConnections ? { connections: services.cloudshareConnections } : {}),
    ...(services.cloudshareClientFactory ? { cloudshare: services.cloudshareClientFactory } : {}),
    logger: services.logger,
  };
}

export async function handleListCohortExamSessions(
  deps: AdminCohortExamSessionDeps,
  request: Omit<AdminCohortExamSessionRequest, "body" | "actor">,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    const sessions = await deps.sessions.listByExamId(exam.id);
    return {
      status: 200,
      body: {
        exam,
        sessions: sessions.map((session) => attachCohortExamSessionInheritedContext(exam, session)),
      },
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handleGetCohortExamSession(
  deps: AdminCohortExamSessionDeps,
  request: AdminCohortExamSessionDetailRequest,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    const session = await deps.sessions.findById(request.sessionId);
    if (!session || session.customerId !== request.customerId || session.examId !== exam.id) {
      return { status: 404, body: { error: `Cohort Exam Session ${request.sessionId} was not found.` } };
    }
    return {
      status: 200,
      body: attachCohortExamSessionInheritedContext(exam, session),
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handleCreateDraftCohortExamSession(
  deps: AdminCohortExamSessionDeps,
  request: AdminCohortExamSessionRequest,
) {
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    if (!isCohortExamSessionDeliveryAvailable(exam)) {
      return {
        status: 409,
        body: { error: "Cohort Exam Sessions are not available for individual-only Exams." },
      };
    }
    const input = parseCreateDraftCohortExamSessionInput(request.body);
    if (!input) {
      return {
        status: 400,
        body: { error: "Draft Cohort Exam Sessions require a name and admission window." },
      };
    }
    const session = await createDraftCohortExamSession(
      {
        repository: deps.sessions,
        now: deps.now,
        newId: deps.newId,
      },
      {
        customerId: request.customerId,
        examId: exam.id,
        ...input,
      },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: session.id },
      examId: exam.id,
      level: "info",
      operation: "cohort_exam_session.create",
      outcome: "success",
      message: "Draft Cohort Exam Session created",
      details: {
        status: session.status,
        changedFields: ["name", "admissionStartsAt", "admissionEndsAt", "capacity", "status"],
      },
    });
    await safeRecordAudit(deps, {
      request,
      action: "cohort_exam_session.created",
      subjectId: session.id,
      examId: exam.id,
      details: {
        status: session.status,
        changedFields: ["name", "admissionStartsAt", "admissionEndsAt", "capacity", "status"],
      },
    });
    return {
      status: 201,
      body: attachCohortExamSessionInheritedContext(exam, session),
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof CohortExamSessionValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }
}

export async function handlePublishCohortExamSession(
  deps: AdminCohortExamSessionDeps,
  request: AdminCohortExamSessionDetailRequest,
) {
  if (!deps.connections || !deps.cloudshare) {
    throw new Error("Cohort Exam Session publishing requires CloudShare dependencies.");
  }
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  try {
    const exam = await findOwnedExam(deps, request.customerId, request.examId);
    if (!isCohortExamSessionDeliveryAvailable(exam)) {
      return {
        status: 409,
        body: { error: "Cohort Exam Sessions are not available for individual-only Exams." },
      };
    }
    const session = await findOwnedSession(deps, request.customerId, exam.id, request.sessionId);
    if (session.status !== "draft") {
      return {
        status: 409,
        body: { error: "Only draft Cohort Exam Sessions can be published." },
      };
    }
    const connection = await deps.connections.findByCustomerId(request.customerId);
    if (!connection) {
      return {
        status: 409,
        body: { error: "CloudShare is not connected for this customer." },
      };
    }
    const claimedSession = await deps.sessions.claimDraftForPublishing({
      id: session.id,
      customerId: request.customerId,
      examId: exam.id,
      claimedAt: (deps.now ?? (() => new Date()))(),
    });
    if (!claimedSession) {
      return {
        status: 409,
        body: { error: "Cohort Exam Session publish is already in progress or has already completed." },
      };
    }

    const creator = createCloudShareOnDemandExperienceCreator(deps.cloudshare.forConnection(connection));
    const created = await creator.createOnDemandExperience({
      name: buildCohortExperienceName(exam.title, claimedSession.name),
      startsAt: claimedSession.admissionStartsAt,
      endsAt: claimedSession.admissionEndsAt,
      projectId: exam.projectId,
      blueprintId: exam.blueprintId,
      policyId: exam.policyId,
      regionIds: exam.allowedRegions.map((region) => region.id),
      instructorId: exam.instructorId,
      timeZoneId: "UTC",
      passphrase: `certalis-${claimedSession.id}`,
    });
    const published = await markCohortExamSessionPublished(
      { repository: deps.sessions, now: deps.now },
      {
        session: claimedSession,
        trainingId: created.trainingId,
        experienceId: created.experienceId,
        teamId: created.teamId,
      },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "cohort_exam_session", id: claimedSession.id },
      examId: exam.id,
      level: "info",
      operation: "cohort_exam_session.publish",
      outcome: "success",
      correlationId,
      message: "Cohort Exam Session published to CloudShare",
      externalIds: {
        trainingId: created.trainingId,
        experienceId: created.experienceId,
        teamId: created.teamId,
      },
      request: created.request as unknown as Record<string, unknown>,
      response: created.response as unknown as Record<string, unknown>,
      details: {
        integrationSurface: created.integrationSurface,
        changedFields: [
          "status",
          "cloudShareTrainingId",
          "cloudShareExperienceId",
          "cloudShareTeamId",
          "publishedAt",
        ],
        scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
      },
    });
    return {
      status: 200,
      body: attachCohortExamSessionInheritedContext(exam, published),
    };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    if (error instanceof CohortExamSessionValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    if (isCloudSharePublishError(error)) {
      const exam = await deps.exams.findById(request.examId);
      const session = await deps.sessions.findById(request.sessionId);
      if (exam && session && exam.customerId === request.customerId && session.customerId === request.customerId) {
        await recordCohortExamSessionPublishFailure(
          { repository: deps.sessions, now: deps.now },
          {
            session,
            correlationId,
            error: "CloudShare could not publish this Cohort Exam Session.",
          },
        );
        await safeRecordDiagnostic(deps, {
          source: "admin-exams",
          customerId: request.customerId,
          actor: request.actor ?? null,
          subject: { type: "cohort_exam_session", id: session.id },
          examId: exam.id,
          level: "warn",
          operation: "cohort_exam_session.publish",
          outcome: "failure",
          correlationId,
          message: "Cohort Exam Session publish failed",
          externalIds: buildPublishFailureExternalIds(exam),
          ...toPublishFailureDiagnostic(error),
        });
      }
      deps.logger.warn("cohort session publish failed", {
        correlationId,
        customerId: request.customerId,
        examId: request.examId,
        sessionId: request.sessionId,
        ...toPublishFailureLogFields(error),
      });
      return {
        status: 502,
        body: {
          error: "CloudShare could not publish this Cohort Exam Session. Check the diagnostic log for the correlation ID.",
          correlationId,
        },
      };
    }
    throw error;
  }
}

async function findOwnedExam(
  deps: Pick<AdminCohortExamSessionDeps, "exams">,
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
  deps: Pick<AdminCohortExamSessionDeps, "sessions">,
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

function buildCohortExperienceName(examTitle: string, sessionName: string): string {
  const name = `${examTitle.trim()} - ${sessionName.trim()}`.trim();
  return name.length <= 100 ? name : name.slice(0, 100);
}

function isCloudSharePublishError(error: unknown): boolean {
  return (
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    (error instanceof Error && error.name.startsWith("CloudShare"))
  );
}

function buildPublishFailureExternalIds(exam: { projectId: string; blueprintId: string; policyId: string }) {
  return {
    projectId: exam.projectId,
    blueprintId: exam.blueprintId,
    policyId: exam.policyId,
  };
}

function toPublishFailureDiagnostic(error: unknown): {
  readonly request?: Record<string, unknown>;
  readonly response?: Record<string, unknown>;
  readonly details: Record<string, unknown>;
} {
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  const baseDetails = {
    integrationSurface: context.integrationSurface ?? "cloudshare.v4.training",
    failureMode: inferPublishFailureMode(error),
  };
  return {
    request: {
      method: context.method ?? "POST",
      path: context.path ?? "/v4/trainings",
      ...(context.requestQuery ? { query: context.requestQuery } : {}),
      ...(context.requestHeaders ? { headers: context.requestHeaders } : {}),
      ...(context.requestBody ? { body: context.requestBody } : {}),
    },
    response:
      context.responseHeaders || context.responseBody || typeof (error as { status?: unknown }).status === "number"
        ? {
            ...(typeof (error as { status?: unknown }).status === "number"
              ? { status: (error as { status: number }).status }
              : {}),
            ...(context.responseHeaders ? { headers: context.responseHeaders } : {}),
            ...(context.responseBody ? { body: context.responseBody } : {}),
          }
        : undefined,
    details: {
      ...baseDetails,
      ...(context.cause ? { cause: context.cause } : {}),
      ...(context.issues ? { issues: context.issues } : {}),
    },
  };
}

function toPublishFailureLogFields(error: unknown): Record<string, unknown> {
  const context = (error as { context?: Record<string, unknown> }).context ?? {};
  return {
    integrationSurface: context.integrationSurface,
    failureMode: inferPublishFailureMode(error),
    responseStatus: (error as { status?: unknown }).status,
  };
}

function inferPublishFailureMode(error: unknown): string {
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

function parseCreateDraftCohortExamSessionInput(body: unknown) {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.name !== "string" || typeof candidate.admissionStartsAt !== "string") {
    return null;
  }
  const admissionStartsAt = new Date(candidate.admissionStartsAt);
  const admissionEndsAt =
    typeof candidate.admissionEndsAt === "string" && candidate.admissionEndsAt.trim()
      ? new Date(candidate.admissionEndsAt)
      : null;
  const capacity =
    typeof candidate.capacity === "number" && Number.isFinite(candidate.capacity)
      ? candidate.capacity
      : null;
  return {
    name: candidate.name,
    admissionStartsAt,
    admissionEndsAt,
    capacity,
  };
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) return;
  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("cohort session diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeRecordAudit(
  deps: Pick<AdminCohortExamSessionDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminCohortExamSessionRequest;
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
    deps.logger.warn("cohort session audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
