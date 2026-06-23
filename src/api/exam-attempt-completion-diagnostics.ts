import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamAttempt } from "@/domain/exam-attempt";

export async function recordExamAttemptCompletionDiagnostic(
  diagnostics: DiagnosticRecorder | undefined,
  attempt: ExamAttempt,
  candidateEmail?: string | null,
): Promise<void> {
  await diagnostics?.record({
    source: "runtime",
    level: "info",
    operation: "exam_attempt.complete",
    outcome: "success",
    message: "Exam completed",
    customerId: attempt.customerId ?? null,
    candidateEmail: candidateEmail ?? null,
    examId: attempt.examId,
    examAttemptId: attempt.id,
    actor: {
      type: "candidate",
      id: attempt.candidateId,
      email: candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: attempt.id,
    },
    details: {
      completedBy: "portal_runtime_reconciliation",
      attemptStatus: attempt.status,
    },
  });
}
