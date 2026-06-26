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
  readonly logger: Logger;
  readonly now?: () => Date;
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
