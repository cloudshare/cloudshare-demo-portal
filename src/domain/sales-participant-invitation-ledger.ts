import { createHash } from "node:crypto";

export const invitationOutcomes = ["confirmed", "confirmed_by_reconciliation", "accepted_unconfirmed", "confirmation_required", "no_replay", "failed_retryable"] as const;
export type InvitationOutcome = typeof invitationOutcomes[number];
export const invitationPhases = ["admitted", "dispatching", "evaluating_confirmation", "settled"] as const;
export type InvitationPhase = typeof invitationPhases[number];
export type InvitationTarget = { readonly participantId: string; readonly intent: "invite" | "resend"; readonly expectedInvitationStatus: "notSent" | "sent"; readonly participantRevision: string };
export type InvitationTargetOutcome = { readonly participantId: string; readonly outcome: InvitationOutcome; readonly reason: string | null };
export type InvitationSafeReason = "provider_rejected" | "ambiguous_after_dispatch" | "confirmation_required" | "failed_retryable" | "stale_revision" | "blocked_by_fence";
export type RevisionedInvitationCommand = { readonly customerId: string; readonly commandId: string; readonly phase: InvitationPhase; readonly revision: number; readonly correlationId: string | null };
export type CurrentInvitationState = { readonly command: RevisionedInvitationCommand; readonly outcome: ReturnType<typeof invitationResult> };
export type Admission = { readonly kind: "admitted" | "same_command" | "blocked"; readonly commandId: string; readonly admissionToken?: string; readonly command?: RevisionedInvitationCommand };
export type FinishInvitationCommand = { readonly commandId: string; readonly expectedRevision: number; readonly expectedPhase: "dispatching" | "evaluating_confirmation" | "settled"; readonly phase: "evaluating_confirmation" | "settled"; readonly correlationId: string | null };
export interface SalesParticipantInvitationLedger {
  admitBatch(input: { customerId: string; sessionId: string; targets: readonly InvitationTarget[]; commandId: string; at: Date }): Promise<Admission>;
  markBatchDispatching(customerId: string, commandId: string, admissionToken: string, expectedRevision: number, at: Date): Promise<RevisionedInvitationCommand>;
  expireAdmitted(customerId: string, commandId: string, expectedRevision: number, at: Date): Promise<RevisionedInvitationCommand>;
  failAdmitted(customerId: string, commandId: string, expectedRevision: number, at: Date): Promise<RevisionedInvitationCommand>;
  finishBatch(input: FinishInvitationCommand & { customerId: string; targetOutcomes: readonly InvitationTargetOutcome[] }): Promise<RevisionedInvitationCommand>;
  /** Command identity is the replay boundary; unlike participant-current
   * reads it remains available after individual fences are released. */
  readCommand(customerId: string, commandId: string): Promise<CurrentInvitationState | null>;
  readCurrent(customerId: string, participantId: string): Promise<CurrentInvitationState | null>;
}
export function invitationScopeHash(input: { customerId: string; sessionId: string; targets: readonly InvitationTarget[] }): string {
  // Canonicalize the scope deliberately. Callers pass admission metadata
  // (`commandId`, `at`) in the same object at runtime, but neither belongs to
  // the idempotency scope: a retried command must compare only the Customer,
  // Session, and ordered target intent/preconditions.
  return createHash("sha256").update(JSON.stringify({
    customerId: input.customerId,
    sessionId: input.sessionId,
    targets: input.targets.map((target) => ({
      participantId: target.participantId,
      intent: target.intent,
      expectedInvitationStatus: target.expectedInvitationStatus,
      participantRevision: target.participantRevision,
    })),
  })).digest("hex");
}
export function invitationResult(input: { commandId: string; outcomes: readonly (InvitationTargetOutcome | { readonly participantId: string; readonly outcome: null; readonly reason: null })[]; correlationId: string | null }) {
  for (const target of input.outcomes) if (target.outcome !== null && !invitationOutcomes.includes(target.outcome)) throw new Error("invalid invitation outcome");
  const counts = Object.fromEntries(invitationOutcomes.map((value) => [value, input.outcomes.filter((target) => target.outcome === value).length]));
  const outcome = input.outcomes.some((target) => target.outcome === null) ? "in_progress" : counts.no_replay ? "blocked" : counts.confirmation_required ? "confirmation_required" : counts.failed_retryable ? "failed_retryable" : counts.accepted_unconfirmed ? "completed_with_unconfirmed" : "completed";
  return { commandId: input.commandId, outcome, correlationId: input.correlationId, counts, targets: input.outcomes };
}
