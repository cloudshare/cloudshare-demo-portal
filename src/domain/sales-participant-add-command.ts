import type { SalesParticipantWorkspaceAddParticipantInput, SalesParticipantWorkspaceAddParticipantResult } from "./sales-participant-workspace";

export type AddCommandState = "admitted" | "dispatched" | "settled" | "needs_attention";
export interface SalesParticipantAddCommandStore {
  admit(input: { customerId: string; sessionId: string; commandId: string; payloadHash: string; now: Date }): Promise<{ kind: "new" | "existing" | "mismatch"; state?: AddCommandState; result?: SalesParticipantWorkspaceAddParticipantResult }>;
  markDispatched(input: { customerId: string; commandId: string; now: Date }): Promise<void>;
  settle(input: { customerId: string; commandId: string; state: "settled" | "needs_attention"; result: SalesParticipantWorkspaceAddParticipantResult; now: Date }): Promise<void>;
}

export function addParticipantPayloadHash(input: SalesParticipantWorkspaceAddParticipantInput): string {
  return JSON.stringify({ sessionId: input.sessionId, person: input.person });
}
