export type PortalUserRole = "admin" | "candidate";
export type PortalCustomerWorkspace = "certification" | "sales" | "both";

export interface PortalCustomerRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly workspace?: PortalCustomerWorkspace;
}

export interface PortalUserRecord {
  readonly id: string;
  readonly customerId: string;
  readonly email: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly passwordHash: string;
  readonly role: PortalUserRole;
  readonly workspace?: PortalCustomerWorkspace;
}

export interface PortalSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly customerId: string;
  readonly role: PortalUserRole;
  readonly workspace?: PortalCustomerWorkspace;
  readonly email: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly issuedAtMs: number;
}

export interface PortalUserStore {
  findByEmail(email: string): Promise<PortalUserRecord | null>;
}

export interface CreatePortalUserInput {
  readonly customerId: string;
  readonly email: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly passwordHash: string;
  readonly role: PortalUserRole;
}

export interface PortalUserProvisioningStore extends PortalUserStore {
  findCustomerBySlug(slug: string): Promise<PortalCustomerRecord | null>;
  createUser(input: CreatePortalUserInput): Promise<PortalUserRecord>;
}

export interface PortalSessionStore {
  save(session: PortalSession): Promise<void>;
  findById(sessionId: string): Promise<PortalSession | null>;
  deleteById(sessionId: string): Promise<void>;
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
    async deleteById(sessionId: string): Promise<void> {
      sessions.delete(sessionId);
    },
    reset(): void {
      sessions.clear();
    },
  };
}
