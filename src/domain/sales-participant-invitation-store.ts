export type InvitationTarget = { readonly participantId: string; readonly intent: "invite" | "resend"; readonly expectedInvitationStatus: "notSent" | "sent"; readonly participantRevision: string; readonly projectionRevision?: string };
export type InvitationTargetOutcome = { readonly participantId: string; readonly outcome: InvitationOutcome; readonly reason: InvitationSafeReason | null };
export type ParticipantInvitationProjection = { readonly participantId: string; readonly expectedParticipantRevision: string; readonly cloudShareParticipantId: string; readonly invitationStatus: "sent" | "notSent"; readonly lastInvitedAt: string | null; readonly invitedBy: string | null; readonly participationStatus: "pending" | "inProgress" | "concluded"; readonly firstJoined: string | null; readonly cloudShareRosterEnvironmentReference: string | null; readonly environmentStatus: string | null; readonly environmentStatusCode: number | null; readonly environmentObservedAt: string | null; readonly environmentAttentionReason: string | null; readonly environmentAttentionSource: string | null; readonly lastReconciledAt: string };
export function invitationResult(input: { commandId: string; outcomes: readonly (InvitationTargetOutcome | { readonly participantId: string; readonly outcome: null; readonly reason: null })[]; correlationId: string | null }) {
  const counts = Object.fromEntries(invitationOutcomes.map((value) => [value, input.outcomes.filter((target) => target.outcome === value).length]));
  const outcome = input.outcomes.some((target) => target.outcome === null) ? "in_progress" : counts.no_replay ? "blocked" : counts.confirmation_required ? "confirmation_required" : counts.failed_retryable ? "failed_retryable" : counts.accepted_unconfirmed ? "completed_with_unconfirmed" : "completed";
  return { commandId: input.commandId, outcome, correlationId: input.correlationId, counts, targets: input.outcomes };
}

declare const invitationHandleBrand: unique symbol;
export type InvitationHandle = string & { readonly [invitationHandleBrand]: true };

export type InvitationState = {
  readonly status: "in_progress" | "awaiting_confirmation" | "settled";
  readonly displayPhase: string;
  readonly correlationId: string | null;
  readonly httpStatus: number | null;
  readonly resultCode: string | null;
  readonly targets: readonly InvitationTarget[];
  readonly outcome: {
    readonly commandId: string;
    readonly outcome: string;
    readonly correlationId: string | null;
    readonly counts: Readonly<Record<string, number>>;
    readonly targets: readonly ({ readonly participantId: string; readonly outcome: string | null; readonly reason: string | null })[];
  };
};

export type InvitationStart =
  | { readonly kind: "started"; readonly handle: InvitationHandle }
  | { readonly kind: "replay"; readonly handle: InvitationHandle; readonly state: InvitationState }
  | { readonly kind: "blocked"; readonly reason: "command_id_mismatch" | "stale_revision" | "active_command_conflict" | "participant_unavailable" | "session_unavailable"; readonly conflictingCommandId?: string };

export interface InvitationStore {
  begin(input: { readonly customerId: string; readonly sessionId: string; readonly commandId: string; readonly targets: readonly InvitationTarget[]; readonly at: Date; readonly allowNew: boolean }): Promise<InvitationStart>;
  authorizeDispatch(handle: InvitationHandle, at: Date): Promise<InvitationHandle>;
  recordAcknowledgement(handle: InvitationHandle, input: { readonly correlationId: string; readonly outcomes: readonly InvitationTargetOutcome[]; readonly at: Date }): Promise<InvitationHandle>;
  settle(handle: InvitationHandle, input: { readonly correlationId: string | null; readonly httpStatus: number; readonly resultCode: string; readonly outcomes: readonly InvitationTargetOutcome[]; readonly projections?: readonly ParticipantInvitationProjection[] }): Promise<InvitationState>;
  failBeforeDispatch(handle: InvitationHandle, input: { readonly at: Date; readonly httpStatus: number; readonly resultCode: string; readonly reason: "not_dispatched" | "failed_retryable" | "stale_revision" }): Promise<InvitationState>;
  load(customerId: string, commandId: string): Promise<{ readonly handle: InvitationHandle; readonly state: InvitationState } | null>;
  readParticipantProjections(input: { readonly customerId: string; readonly sessionId: string; readonly participantIds: readonly string[]; readonly at: Date }): Promise<ReadonlyMap<string, { readonly currentCommandId: string | null; readonly invitationOutcome: InvitationTargetOutcome["outcome"] | null; readonly invitationReason: InvitationTargetOutcome["reason"] | null; readonly invitationCorrelationId: string | null; readonly latestInvitationOutcome: InvitationTargetOutcome["outcome"] | null; readonly latestInvitationReason: InvitationTargetOutcome["reason"] | null; readonly latestInvitationCorrelationId: string | null }>>;
}
import { invitationOutcomes, type InvitationOutcome, type InvitationSafeReason } from "./sales-participant-workspace";
export { invitationOutcomes };
export type { InvitationOutcome, InvitationSafeReason };
