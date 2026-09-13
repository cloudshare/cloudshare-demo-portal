export interface SalesParticipantLaunchLink {
  readonly id: string; readonly customerId: string; readonly salesDemoSessionId: string;
  readonly salesSessionParticipantId: string; readonly tokenHash: string; readonly revokedAt: Date | null; readonly createdAt: Date;
}
export interface SalesParticipantLaunchLinkRepository {
  create(link: SalesParticipantLaunchLink, correlationId?: string, revision?: number): Promise<void>;
  /** Atomically revokes a previous active capability and persists its replacement. */
  regenerate(link: SalesParticipantLaunchLink, at: Date, correlationId?: string, revision?: number): Promise<void>;
  revokeActive(customerId: string, salesDemoSessionId: string, participantId: string, at: Date, correlationId?: string, revision?: number): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SalesParticipantLaunchLink | null>;
}
