export type PortalUserRole = "admin" | "candidate";

export interface PortalUserRecord {
  readonly id: string;
  readonly customerId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: PortalUserRole;
}

export interface PortalSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly customerId: string;
  readonly role: PortalUserRole;
  readonly email: string;
  readonly issuedAtMs: number;
}

export interface PortalUserStore {
  findByEmail(email: string): Promise<PortalUserRecord | null>;
}

export interface PortalSessionStore {
  save(session: PortalSession): Promise<void>;
  findById(sessionId: string): Promise<PortalSession | null>;
}

export function createInMemoryPortalUserStore(
  users: readonly PortalUserRecord[],
): PortalUserStore {
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  return {
    async findByEmail(email: string): Promise<PortalUserRecord | null> {
      return byEmail.get(email.trim().toLowerCase()) ?? null;
    },
  };
}

export function createInMemoryPortalSessionStore(): PortalSessionStore & { reset(): void } {
  const sessions = new Map<string, PortalSession>();
  return {
    async save(session: PortalSession): Promise<void> {
      sessions.set(session.sessionId, session);
    },
    async findById(sessionId: string): Promise<PortalSession | null> {
      return sessions.get(sessionId) ?? null;
    },
    reset(): void {
      sessions.clear();
    },
  };
}
