import type { SalesParticipantWorkspaceAddParticipantInput, SalesParticipantWorkspaceAddParticipantResult } from "./sales-participant-workspace";

export type AddCommandState = "admitted" | "dispatched" | "settled" | "needs_attention";
export interface SalesParticipantAddCommandStore {
  admit(input: { customerId: string; sessionId: string; commandId: string; targetKey?: string; payloadHash: string; now: Date }): Promise<{ kind: "new" | "existing" | "mismatch"; state?: AddCommandState; result?: SalesParticipantWorkspaceAddParticipantResult }>;
  /** Returns true only when this command atomically crosses the dispatch fence. */
  markDispatched(input: { customerId: string; commandId: string; now: Date }): Promise<boolean>;
  settle(input: { customerId: string; commandId: string; state: "settled" | "needs_attention"; result: SalesParticipantWorkspaceAddParticipantResult; now: Date }): Promise<void>;
}

export function addParticipantPayloadHash(input: SalesParticipantWorkspaceAddParticipantInput): string {
  return JSON.stringify({ sessionId: input.sessionId, person: input.person });
}
