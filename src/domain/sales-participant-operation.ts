export type SalesParticipantOperation = "invite" | "resend" | "launch" | "revoke";
export type SalesParticipantOperationCapability = "email" | "launch";
export type SalesParticipantOperationDisposition = "ready" | "pending_confirmation" | "no_replay" | "confirmed" | "failed_retryable";

export interface SalesParticipantOperationState {
  readonly customerId: string;
  readonly participantId: string;
  readonly capability: SalesParticipantOperationCapability;
  readonly disposition: SalesParticipantOperationDisposition;
  readonly correlationId: string | null;
  readonly resultMetadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
  readonly confirmedAt: Date | null;
}

export interface SalesParticipantOperationRepository {
  get(customerId: string, participantId: string, capability: SalesParticipantOperationCapability): Promise<SalesParticipantOperationState | null>;
  save(state: SalesParticipantOperationState): Promise<void>;
  listForParticipants(customerId: string, participantIds: readonly string[]): Promise<readonly SalesParticipantOperationState[]>;
}

export type RetryDisposition = "retryable" | "no_replay";

export function retryDispositionForDispatch(dispatch: "not_started" | "acknowledged" | "ambiguous_after_dispatch"): RetryDisposition {
  return dispatch === "ambiguous_after_dispatch" ? "no_replay" : "retryable";
}

export function operationStateForResult(input: {
  readonly customerId: string;
  readonly participantId: string;
  readonly capability: SalesParticipantOperationCapability;
  readonly correlationId: string;
  readonly disposition: SalesParticipantOperationDisposition;
  readonly resultMetadata?: Readonly<Record<string, string | number | boolean | null>>;
  readonly now: Date;
}): SalesParticipantOperationState {
  return {
    customerId: input.customerId,
    participantId: input.participantId,
    capability: input.capability,
    disposition: input.disposition,
    correlationId: input.correlationId,
    resultMetadata: input.resultMetadata ?? {},
    startedAt: input.now,
    updatedAt: input.now,
    confirmedAt: input.disposition === "confirmed" ? input.now : null,
  };
}
