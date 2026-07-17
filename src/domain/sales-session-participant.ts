export interface SalesSessionParticipant {
  readonly id: string; readonly customerId: string; readonly salesDemoSessionId: string; readonly opportunityContactId: string; readonly cloudShareParticipantId: string;
  readonly invitationStatus: "sent" | "notSent"; readonly invitedBy: string | null; readonly participationStatus: "pending" | "inProgress" | "concluded"; readonly firstJoined: string | null; readonly environmentStatus: string | null; readonly lastReconciledAt: Date; readonly createdAt: Date; readonly updatedAt: Date;
}
export interface SalesSessionParticipantRepository { save(participant: SalesSessionParticipant): Promise<void>; list(customerId: string, sessionId: string): Promise<readonly SalesSessionParticipant[]>; }
