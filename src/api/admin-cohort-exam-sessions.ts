import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import {
  attachCohortExamSessionInheritedContext,
  CohortExamSessionValidationError,
  createDraftCohortExamSession,
  type CohortExamSessionRepository,
} from "@/domain/cohort-exam-session";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  ExamNotFoundError,
  isCohortExamSessionDeliveryAvailable,
  type ExamRepository,
} from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";

export interface AdminCohortExamSessionDeps {
  readonly exams: ExamRepository;
  readonly sessions: CohortExamSessionRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newAuditId?: () => string;
}

export interface AdminCohortExamSessionServices {
  readonly exams: ExamRepository;
  readonly cohortExamSessions: CohortExamSessionRepository;
  readonly diagnosticRecorder?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
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
}

export function buildAdminCohortExamSessionDeps(
  services: AdminCohortExamSessionServices,
): AdminCohortExamSessionDeps {
  return {
    exams: services.exams,
    sessions: services.cohortExamSessions,
    diagnostics: services.diagnosticRecorder,
    ...(services.audit ? { audit: services.audit } : {}),
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
