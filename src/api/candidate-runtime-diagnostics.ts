import type { ExamAttempt } from "@/domain/exam-attempt";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";

export type CandidateLabLaunchAttemptedAction = "enter" | "resume" | "open";
export type CandidateLabLaunchFailureReason = "popup_blocked" | "open_failed";

export interface CandidateRuntimeDiagnosticsDeps {
  readonly diagnostics?: DiagnosticRecorder;
}

export interface CandidateRuntimeDiagnosticsResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleRecordCandidateLabLaunchFailure(
  deps: CandidateRuntimeDiagnosticsDeps,
  request: {
    readonly attempt: ExamAttempt;
    readonly candidateId: string;
    readonly candidateEmail?: string | null;
    readonly attemptedAction: CandidateLabLaunchAttemptedAction;
    readonly failureReason: CandidateLabLaunchFailureReason;
    readonly candidateMessage: string;
    readonly reportedAttemptStatus?: string | null;
  },
): Promise<CandidateRuntimeDiagnosticsResponse> {
  await deps.diagnostics?.record({
    source: "runtime",
    level: "warn",
    operation:
      request.failureReason === "popup_blocked"
        ? "candidate.lab_launch.popup_blocked"
        : "candidate.lab_launch.open_failed",
    outcome: "failure",
    customerId: request.attempt.customerId,
    candidateEmail: request.candidateEmail ?? null,
    examId: request.attempt.examId,
    examAttemptId: request.attempt.id,
    actor: {
      type: "candidate",
      id: request.candidateId,
      email: request.candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: request.attempt.id,
    },
    message:
      request.failureReason === "popup_blocked"
        ? "Candidate lab window was blocked by the browser"
        : "Candidate lab window failed to open",
    details: {
      attemptedAction: request.attemptedAction,
      attemptStatus: request.attempt.status,
      reportedAttemptStatus: request.reportedAttemptStatus ?? null,
      failureReason: request.failureReason,
      candidateMessage: request.candidateMessage,
      route: "/api/candidate/runtime-diagnostics",
    },
  });

  return {
    status: 202,
    body: { ok: true },
  };
}
