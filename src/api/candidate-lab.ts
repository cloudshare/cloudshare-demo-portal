import type { ExamClock } from "@/domain/exam-clock";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { Logger } from "@/observability/logger";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";

export interface CandidateLabStatusDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams: ExamRepository;
  readonly clocks?: ExamClock;
  readonly diagnostics?: DiagnosticRecorder;
  readonly candidateEmail?: string;
  readonly logger: Logger;
}

export interface CandidateLabStatusResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleGetCandidateLabStatus(
  deps: CandidateLabStatusDeps,
  request: {
    readonly examAttemptId: string;
    readonly candidateId: string;
  },
): Promise<CandidateLabStatusResponse> {
  const attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }
  if (attempt.candidateId !== request.candidateId) {
    deps.logger.warn("candidate requested another candidate's lab status", {
      examAttemptId: request.examAttemptId,
      candidateId: request.candidateId,
      ownerCandidateId: attempt.candidateId,
      customerId: attempt.customerId ?? null,
      examId: attempt.examId,
    });
    return { status: 403, body: { error: "forbidden" } };
  }

  const completion = await reconcileExamAttemptCompletion(deps, {
    examAttemptId: request.examAttemptId,
  });

  const reconciledAttempt = await deps.attempts.findById(request.examAttemptId);
  if (!reconciledAttempt) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }
  if (completion?.changed && completion.status === "completed") {
    await recordExamAttemptCompletionDiagnostic(
      deps.diagnostics,
      reconciledAttempt,
      deps.candidateEmail,
    );
  }

  const exam = await deps.exams.findById(reconciledAttempt.examId);
  if (!exam) {
    return { status: 404, body: { error: "exam not found" } };
  }

  return {
    status: 200,
    body: {
      examAttemptId: reconciledAttempt.id,
      examTitle: exam.title,
      timeLimitMinutes: exam.timeLimitMinutes,
      status: reconciledAttempt.status,
      scheduledFor: reconciledAttempt.scheduledFor?.toISOString() ?? null,
    },
  };
}
