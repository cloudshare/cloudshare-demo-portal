import type { DiagnosticActor, DiagnosticSubject } from "@/domain/diagnostic-log";

/** Operation-owned ordering state. Reuse one allocator for every client in one workflow. */
export interface CloudShareWorkflowSequenceAllocator {
  next(): number;
}

export function createCloudShareWorkflowSequenceAllocator(): CloudShareWorkflowSequenceAllocator {
  let sequence = 0;
  return { next: () => ++sequence };
}

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
  /** Shared only by clients constructed for this one logical operation. */
  readonly sequenceAllocator?: CloudShareWorkflowSequenceAllocator;
};
