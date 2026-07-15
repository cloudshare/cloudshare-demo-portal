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
  readonly createdAt: Date;
}

export interface SalesDemoSessionRepository {
  save(session: SalesDemoSession): Promise<void>;
  listByOpportunity(customerId: string, opportunityId: string): Promise<readonly SalesDemoSession[]>;
}

export function createInMemorySalesDemoSessionRepository(): SalesDemoSessionRepository {
  const sessions = new Map<string, SalesDemoSession>();
  return {
    async save(session) { sessions.set(session.id, session); },
    async listByOpportunity(customerId, opportunityId) {
      return [...sessions.values()].filter((session) => session.customerId === customerId && session.opportunityId === opportunityId);
    },
  };
}
