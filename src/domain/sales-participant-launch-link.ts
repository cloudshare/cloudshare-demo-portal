export interface SalesParticipantLaunchLink {
  readonly id: string; readonly customerId: string; readonly salesDemoSessionId: string;
  readonly salesSessionParticipantId: string; readonly tokenHash: string; readonly revokedAt: Date | null; readonly createdAt: Date;
}
export interface SalesParticipantLaunchLinkRepository {
  create(link: SalesParticipantLaunchLink): Promise<void>;
  /** Atomically revokes a previous active capability and persists its replacement. */
  regenerate(link: SalesParticipantLaunchLink, at: Date): Promise<void>;
  revokeActive(customerId: string, salesDemoSessionId: string, participantId: string, at: Date): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SalesParticipantLaunchLink | null>;
  hasActive(customerId: string, salesDemoSessionId: string, participantId: string): Promise<boolean>;
}
