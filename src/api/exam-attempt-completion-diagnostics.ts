import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamAttempt } from "@/domain/exam-attempt";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { LabLaunch } from "@/domain/lab-launch";

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

export async function recordExamAttemptCompletionEnvironmentDiagnostic(
  deps: {
    readonly diagnostics: DiagnosticRecorder | undefined;
    readonly source: EnvironmentStateSource | undefined;
  },
  input: {
    readonly attempt: ExamAttempt;
    readonly launch: LabLaunch | null | undefined;
    readonly candidateEmail?: string | null;
    readonly completionReason: string;
  },
): Promise<void> {
  const environmentExternalId =
    input.launch?.environmentExternalId ?? input.launch?.environmentId ?? null;
  if (!deps.diagnostics || !environmentExternalId) {
    return;
  }

  const base = {
    source: "runtime" as const,
    customerId: input.attempt.customerId ?? null,
    candidateEmail: input.candidateEmail ?? input.launch?.participantEmail ?? null,
    examId: input.attempt.examId,
    examAttemptId: input.attempt.id,
    actor: {
      type: "candidate" as const,
      id: input.attempt.candidateId,
      email: input.candidateEmail ?? input.launch?.participantEmail ?? null,
    },
    subject: {
      type: "exam_attempt" as const,
      id: input.attempt.id,
    },
    externalIds: {
      environmentExternalId,
      ...(input.launch?.trainingId ? { trainingId: input.launch.trainingId } : {}),
    },
  };

  if (!deps.source) {
    await deps.diagnostics.record({
      ...base,
      level: "warn",
      operation: "cloudshare.environment.completion_reconcile",
      outcome: "failure",
      message: "CloudShare environment state was not checked after exam completion",
      details: {
        completionReason: input.completionReason,
        failureMode: "missing_environment_source",
      },
    });
    return;
  }

  try {
    const snapshot = await deps.source.getEnvironmentState(environmentExternalId);
    await deps.diagnostics.record({
      ...base,
      operation: "cloudshare.environment.completion_reconcile",
      outcome: "success",
      message: snapshot
        ? "CloudShare environment state checked after exam completion"
        : "CloudShare environment was not found after exam completion",
      externalIds: {
        ...base.externalIds,
        ...(snapshot?.status ? { environmentStatus: snapshot.status } : {}),
      },
      details: {
        completionReason: input.completionReason,
        attemptedOperation: "get_environment",
        integrationSurface: "cloudshare.v3.env.get",
        environmentFound: Boolean(snapshot),
      },
    });
  } catch (err) {
    await deps.diagnostics.record({
      ...base,
      level: "warn",
      operation: "cloudshare.environment.completion_reconcile",
      outcome: "failure",
      message: "CloudShare environment state check failed after exam completion",
      details: {
        completionReason: input.completionReason,
        attemptedOperation: "get_environment",
        integrationSurface: "cloudshare.v3.env.get",
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
