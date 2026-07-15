import type { SalesExperienceType } from "./item";

/** Durable portal correlation for one direct CloudShare Sales Experience. */
export interface SalesDemoSession {
  readonly id: string;
  readonly customerId: string;
  readonly opportunityId: string;
  readonly itemId: string;
  readonly cloudShareSalesExperienceId: string;
  readonly externalId: string;
  readonly type: SalesExperienceType;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  /** Selected from a fresh live Project-member read at provision time, never from Item config. */
  readonly salesProEmail: string;
  readonly salesProDisplayName: string;
  readonly registrationType: "registeredParticipantsOnly";
  readonly sendInvitations: "dontSend";
  /** Provider-facing display name, bounded to CloudShare's documented limit. */
  readonly sessionName?: string;
  /** Monotonic within the Customer + Opportunity delivery history. */
  readonly revision?: number;
  readonly operationalStatus?: "provisioning" | "active" | "needs_attention";
  readonly attentionReason?: string | null;
  readonly createdAt: Date;
}

export interface SalesDemoSessionRepository {
  save(session: SalesDemoSession): Promise<void>;
  /** Optional during the #347 create-only compatibility period. #356's
   * operational read module requires this capability explicitly. */
  list?(customerId: string): Promise<readonly SalesDemoSession[]>;
  listByOpportunity(customerId: string, opportunityId: string): Promise<readonly SalesDemoSession[]>;
  findById?(customerId: string, id: string): Promise<SalesDemoSession | null>;
  updateOperationalState?(id: string, state: { cloudShareSalesExperienceId?: string; operationalStatus: "active" | "needs_attention"; attentionReason?: string | null }): Promise<void>;
}

export function createInMemorySalesDemoSessionRepository(): SalesDemoSessionRepository {
  const sessions = new Map<string, SalesDemoSession>();
  return {
    async save(session) { sessions.set(session.id, session); },
    async list(customerId) { return [...sessions.values()].filter((session) => session.customerId === customerId); },
    async listByOpportunity(customerId, opportunityId) {
      return [...sessions.values()].filter((session) => session.customerId === customerId && session.opportunityId === opportunityId);
    },
  };
}
