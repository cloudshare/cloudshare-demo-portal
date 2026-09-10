import type { SalesExperienceType } from "./sales-experience-type";
import type { CloudShareSalesExperienceStatus } from "./sales-session-status";

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
  /** Persisted CloudShare invitation capability for this Experience. Legacy
   * sessions may still have the disabled value until recreated or amended. */
  readonly sendInvitations: "dontSend" | "salesProsAndParticipants";
  /** Provider-facing display name, bounded to CloudShare's documented limit. */
  readonly sessionName?: string;
  /** Monotonic within the Customer + Opportunity delivery history. */
  readonly revision?: number;
  readonly operationalStatus?: "provisioning" | "active" | "needs_attention";
  readonly attentionReason?: string | null;
  /** Last documented v4 GET /sales observation. Never inferred from a roster. */
  readonly experienceStatus?: CloudShareSalesExperienceStatus | null;
  readonly experienceStatusObservedAt?: Date | null;
  readonly createdAt: Date;
}

export interface SalesDemoSessionRepository {
  save(session: SalesDemoSession): Promise<void>;
  /** Optional during the #347 create-only compatibility period. #356's
   * operational read module requires this capability explicitly. */
  list?(customerId: string): Promise<readonly SalesDemoSession[]>;
  listForRefresh?(customerId: string, input: { readonly targetIds: readonly string[]; readonly limit: number }): Promise<readonly SalesDemoSession[]>;
  /** Uses the persisted Opportunity relation so Account-filtered history does
   * not expand into a Customer-wide Session scan plus per-row lookups. */
  listByAccount?(customerId: string, accountId: string): Promise<readonly SalesDemoSession[]>;
  listByOpportunity(customerId: string, opportunityId: string): Promise<readonly SalesDemoSession[]>;
  findById?(customerId: string, id: string): Promise<SalesDemoSession | null>;
  /** Deletes only the exact pending reservation created by this request after
   * an outcome-ambiguous save failure. Returns false if it was absent or no
   * longer matches, so a concurrent request can never be removed. */
  discardReservation?(reservation: Pick<SalesDemoSession, "id" | "customerId" | "opportunityId" | "revision" | "cloudShareSalesExperienceId" | "operationalStatus">): Promise<boolean>;
  updateOperationalState?(customerId: string, id: string, state: { cloudShareSalesExperienceId?: string; salesProEmail?: string; salesProDisplayName?: string; operationalStatus: "active" | "needs_attention"; attentionReason?: string | null; experienceStatus?: CloudShareSalesExperienceStatus | null; experienceStatusObservedAt?: Date | null }): Promise<void>;
  recordExperienceObservations?(customerId: string, observations: readonly { readonly id: string; readonly experienceStatus: CloudShareSalesExperienceStatus; readonly experienceStatusObservedAt: Date }[]): Promise<void>;
  recordExperienceObservation?(customerId: string, id: string, observation: { readonly experienceStatus: CloudShareSalesExperienceStatus; readonly experienceStatusObservedAt: Date }): Promise<void>;
  updateDisplayName?(id: string, sessionName: string): Promise<void>;
}

/** A repository-normalized conflict for the one reservation key used before
 * any CloudShare interaction. Other persistence errors remain retryable local
 * failures rather than being misreported as revision collisions. */
export class SalesDemoSessionRevisionConflictError extends Error {
  constructor() { super("Sales Enablement Session revision is already reserved."); this.name = "SalesDemoSessionRevisionConflictError"; }
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
