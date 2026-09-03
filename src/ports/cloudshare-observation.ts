import type { DiagnosticActor, DiagnosticSubject } from "@/domain/diagnostic-log";

/** Neutral factory-port context; neither domain nor integration owns the other. */
export type CloudShareWorkflowObservationContext = {
  readonly actor: DiagnosticActor;
  readonly subject: DiagnosticSubject | (() => DiagnosticSubject);
  readonly correlationId: string;
  readonly source: string;
  readonly externalIds?: Record<string, string>;
  readonly candidateEmail?: string | null;
  readonly examId?: string | null;
  readonly examAttemptId?: string | null;
};
