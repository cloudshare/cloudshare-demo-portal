export type SalesParticipantExtensionTargetOutcome = "pending" | "confirmed" | "failed_retryable" | "needs_attention";
export type SalesParticipantExtensionDispatchState = "admitted" | "dispatching" | "settled" | "needs_attention";

export interface SalesParticipantExtensionTarget {
  readonly participantId: string;
  readonly participantRevision: string;
  readonly environmentId: string;
  readonly preExpiry: string;
  readonly outcome: SalesParticipantExtensionTargetOutcome;
  readonly reason: string | null;
  readonly confirmedExpiry: string | null;
}

export interface SalesParticipantExtensionCommand {
  readonly customerId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly targetEnd: string;
  readonly dispatchState: SalesParticipantExtensionDispatchState;
  readonly revision: number;
  readonly correlationId: string | null;
  readonly targets: readonly SalesParticipantExtensionTarget[];
}

export interface SalesParticipantExtensionCommandStore {
  admit(input: { customerId: string; sessionId: string; commandId: string; targetEnd: string; targets: readonly Omit<SalesParticipantExtensionTarget, "outcome" | "reason" | "confirmedExpiry">[] }): Promise<{ kind: "new" | "existing" | "mismatch"; command?: SalesParticipantExtensionCommand }>;
  markDispatching(input: { customerId: string; commandId: string; expectedRevision: number }): Promise<boolean>;
  settle(input: { customerId: string; commandId: string; expectedRevision: number; dispatchState: "settled" | "needs_attention"; targets: readonly Pick<SalesParticipantExtensionTarget, "participantId" | "outcome" | "reason" | "confirmedExpiry">[]; correlationId: string | null }): Promise<SalesParticipantExtensionCommand>;
  read(customerId: string, commandId: string): Promise<SalesParticipantExtensionCommand | null>;
}
