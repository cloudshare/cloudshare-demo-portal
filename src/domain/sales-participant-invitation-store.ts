import type { InvitationTarget, InvitationTargetOutcome, ParticipantInvitationProjection } from "@/domain/sales-participant-invitation-ledger";

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
  | { readonly kind: "blocked"; readonly reason: "command_id_mismatch" | "precondition_failed" | "session_unavailable" };

export interface InvitationStore {
  begin(input: { readonly customerId: string; readonly sessionId: string; readonly commandId: string; readonly targets: readonly InvitationTarget[]; readonly at: Date; readonly allowNew: boolean }): Promise<InvitationStart>;
  authorizeDispatch(handle: InvitationHandle, at: Date): Promise<InvitationHandle>;
  recordAcknowledgement(handle: InvitationHandle, input: { readonly correlationId: string; readonly outcomes: readonly InvitationTargetOutcome[]; readonly at: Date }): Promise<InvitationHandle>;
  settle(handle: InvitationHandle, input: { readonly correlationId: string | null; readonly httpStatus: number; readonly resultCode: string; readonly outcomes: readonly InvitationTargetOutcome[]; readonly projections?: readonly ParticipantInvitationProjection[] }): Promise<InvitationState>;
  failBeforeDispatch(handle: InvitationHandle, input: { readonly at: Date; readonly httpStatus: number; readonly resultCode: string; readonly reason: "not_dispatched" | "failed_retryable" | "stale_revision" }): Promise<InvitationState>;
  load(customerId: string, commandId: string): Promise<{ readonly handle: InvitationHandle; readonly state: InvitationState } | null>;
  readParticipantProjections(input: { readonly customerId: string; readonly sessionId: string; readonly participantIds: readonly string[] }): Promise<ReadonlyMap<string, { readonly currentCommandId: string | null; readonly invitationOutcome: InvitationTargetOutcome["outcome"] | null; readonly invitationReason: InvitationTargetOutcome["reason"] | null; readonly invitationCorrelationId: string | null; readonly invitationRevision: number | null; readonly latestInvitationOutcome: InvitationTargetOutcome["outcome"] | null; readonly latestInvitationReason: InvitationTargetOutcome["reason"] | null; readonly latestInvitationCorrelationId: string | null }>>;
}
