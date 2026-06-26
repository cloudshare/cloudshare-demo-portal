import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { ExamClock } from "@/domain/exam-clock";
import type { ExamRepository } from "@/domain/exam-catalog";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";

export interface ExamAttemptCompletionSettlementDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams?: ExamRepository;
  readonly clocks?: ExamClock;
  readonly diagnostics?: DiagnosticRecorder;
  readonly candidateEmail?: string | null;
}

export interface ExamAttemptCompletionSettlementRequest {
  readonly examAttemptId: string;
}

export type ExamAttemptCompletionSettlementResult =
  | {
      readonly kind: "found";
      readonly attempt: ExamAttempt;
    }
  | {
      readonly kind: "not_found";
    };

export async function settleExamAttemptCompletion(
  deps: ExamAttemptCompletionSettlementDeps,
  request: ExamAttemptCompletionSettlementRequest,
): Promise<ExamAttemptCompletionSettlementResult> {
  const completion = await reconcileExamAttemptCompletion(
    {
      attempts: deps.attempts,
      exams: deps.exams ?? emptyExamRepository(),
      clocks: deps.clocks,
    },
    { examAttemptId: request.examAttemptId },
  );

  const attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return { kind: "not_found" };
  }

  if (completion?.changed && completion.status === "completed") {
    await recordExamAttemptCompletionDiagnostic(
      deps.diagnostics,
      attempt,
      deps.candidateEmail,
    );
  }

  return {
    kind: "found",
    attempt,
  };
}

function emptyExamRepository(): ExamRepository {
  return {
    save: async () => {},
    findById: async () => null,
    listByCustomerId: async () => [],
  };
}
