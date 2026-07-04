import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticActor, DiagnosticLogEntryInput, DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  ExamNotFoundError,
  unpublishExam,
  type ExamRepository,
} from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";

export interface AdminExamUnpublishRuntimeDeps {
  readonly repository: ExamRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newAuditId?: () => string;
}

export interface AdminExamUnpublishRuntimeRequest {
  readonly customerId: string;
  readonly actor?: DiagnosticActor | null;
  readonly examId: string;
}

export interface AdminExamUnpublishRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function unpublishAdminExamRuntime(
  deps: AdminExamUnpublishRuntimeDeps,
  request: AdminExamUnpublishRuntimeRequest,
): Promise<AdminExamUnpublishRuntimeResponse> {
  try {
    const exam = await unpublishExam(
      { repository: deps.repository, now: deps.now },
      { customerId: request.customerId, examId: request.examId },
    );
    await safeRecordDiagnostic(deps, {
      source: "admin-exams",
      customerId: request.customerId,
      actor: request.actor ?? null,
      subject: { type: "exam", id: exam.id },
      examId: exam.id,
      level: "info",
      operation: "exam.unpublish",
      outcome: "success",
      message: "Exam unpublished",
      details: { changedFields: ["status", "publishedAt"] },
    });
    await safeRecordAudit(deps, {
      request,
      action: "exam.unpublished",
      subjectId: exam.id,
      examId: exam.id,
      outcome: "success",
      details: { changedFields: ["status", "publishedAt"] },
    });
    return { status: 200, body: { exam } };
  } catch (error) {
    if (error instanceof ExamNotFoundError) {
      return { status: 404, body: { error: error.message } };
    }
    throw error;
  }
}

async function safeRecordDiagnostic(
  deps: { readonly diagnostics?: DiagnosticRecorder; readonly logger: Logger },
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) {
    return;
  }

  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("admin exam diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function safeRecordAudit(
  deps: Pick<AdminExamUnpublishRuntimeDeps, "audit" | "logger" | "now" | "newAuditId">,
  input: {
    readonly request: AdminExamUnpublishRuntimeRequest;
    readonly action: string;
    readonly subjectId: string;
    readonly examId: string;
    readonly outcome: "success" | "failure" | "denied";
    readonly details?: Record<string, unknown>;
    readonly error?: string;
  },
): Promise<void> {
  if (!deps.audit) {
    return;
  }

  try {
    await deps.audit.write({
      id: (deps.newAuditId ?? randomUUID)(),
      customerId: input.request.customerId,
      actorType: input.request.actor?.type ?? null,
      actorId: input.request.actor?.id ?? null,
      actorEmail: input.request.actor?.email ?? null,
      action: input.action,
      subjectType: "exam",
      subjectId: input.subjectId,
      outcome: input.outcome,
      examId: input.examId,
      details: input.details ?? null,
      error: input.error ?? null,
      occurredAt: (deps.now ?? (() => new Date()))(),
    });
  } catch (error) {
    deps.logger.warn("admin exam audit recording failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
