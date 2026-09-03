import type { CloudShareClientFactory } from "@/domain/cloudshare-connection";
import type { DiagnosticActor, DiagnosticSubject } from "@/domain/diagnostic-log";
import { createCloudShareWorkflowSequenceAllocator, type CloudShareWorkflowSequenceAllocator } from "@/ports/cloudshare-observation";

/**
 * The one caller-facing seam for certification CloudShare wire observations.
 * It keeps the factory interface small while ensuring its OAuth and request
 * callbacks carry the same authoritative support thread.
 */
export function certificationCloudShareWorkflow(input: {
  readonly actor: DiagnosticActor | null | undefined;
  readonly customerId: string;
  readonly subject: DiagnosticSubject;
  readonly correlationId: string;
  readonly source: string;
  readonly examId?: string;
  readonly examAttemptId?: string;
  readonly candidateEmail?: string;
  readonly externalIds?: Record<string, string>;
  readonly sequenceAllocator?: CloudShareWorkflowSequenceAllocator;
}): NonNullable<Parameters<CloudShareClientFactory["forConnection"]>[1]> {
  return {
    scope: "workflow",
    workflow: {
      actor: input.actor ?? { type: "system", id: "certification-workflow" },
      subject: input.subject,
      correlationId: input.correlationId,
      source: input.source,
      sequenceAllocator: input.sequenceAllocator ?? createCloudShareWorkflowSequenceAllocator(),
      ...(input.examId ? { examId: input.examId } : {}),
      ...(input.examAttemptId ? { examAttemptId: input.examAttemptId } : {}),
      ...(input.candidateEmail ? { candidateEmail: input.candidateEmail } : {}),
      ...(input.externalIds ? { externalIds: input.externalIds } : {}),
    },
  };
}

export function customerDefaultCloudShareScope(
  reason: "catalogue_resource_read" | "connection_check" | "unanchored_support_read",
): NonNullable<Parameters<CloudShareClientFactory["forConnection"]>[1]> {
  return { scope: "customer_default", reason };
}
