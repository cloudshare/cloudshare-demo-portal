export type SalesParticipantLaunchOperationKind = "generate" | "revoke";
export type SalesParticipantLaunchOutcome = "success" | "failure";

export interface SalesParticipantLaunchOperation {
  readonly id: string;
  readonly customerId: string;
  readonly salesDemoSessionId: string;
  readonly salesSessionParticipantId: string;
  readonly correlationId: string;
  readonly operation: SalesParticipantLaunchOperationKind;
  readonly outcome: SalesParticipantLaunchOutcome;
  readonly safeReason: string | null;
  readonly occurredAt: Date;
  readonly revision: number;
}

export interface SalesParticipantLaunchOperationRepository {
  record(operation: SalesParticipantLaunchOperation): Promise<void>;
  latestForParticipants(input: { customerId: string; sessionId: string; participantIds: readonly string[] }): Promise<readonly SalesParticipantLaunchOperation[]>;
}
