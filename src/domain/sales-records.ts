/** Local Certalis sales records. These deliberately do not model a CRM or a
 * CloudShare Sales Experience; a Sales Opportunity only becomes an external
 * delivery concern in a later slice. */
export type AccountKind = "prospect" | "current_customer";
export type OpportunityStatus = "open" | "won" | "lost";

export interface SalesAccount {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SalesOpportunity {
  readonly id: string;
  readonly customerId: string;
  readonly accountId: string;
  readonly name: string;
  readonly status: OpportunityStatus;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OpportunityContact {
  readonly id: string;
  readonly customerId: string;
  readonly opportunityId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SalesRecordRepository {
  listAccounts(customerId: string, search?: string): Promise<readonly SalesAccount[]>;
  findAccount(customerId: string, id: string): Promise<SalesAccount | null>;
  saveAccount(account: SalesAccount): Promise<void>;
  removeAccountForCompensation(customerId: string, id: string): Promise<void>;
  listOpportunities(customerId: string, search?: string): Promise<readonly SalesOpportunity[]>;
  findOpportunity(customerId: string, id: string): Promise<SalesOpportunity | null>;
  saveOpportunity(opportunity: SalesOpportunity): Promise<void>;
  removeOpportunityForCompensation(customerId: string, id: string): Promise<void>;
  listContacts(customerId: string, opportunityId?: string): Promise<readonly OpportunityContact[]>;
  findContact(customerId: string, id: string): Promise<OpportunityContact | null>;
  saveContact(contact: OpportunityContact): Promise<void>;
  removeContactForCompensation(customerId: string, id: string): Promise<void>;
}

export function createInMemorySalesRecordRepository(): SalesRecordRepository {
  const accounts = new Map<string, SalesAccount>();
  const opportunities = new Map<string, SalesOpportunity>();
  const contacts = new Map<string, OpportunityContact>();
  const matches = (values: readonly string[], search?: string) => !search ||
    values.join(" ").toLowerCase().includes(search.trim().toLowerCase());

  return {
    async listAccounts(customerId, search) {
      return [...accounts.values()].filter((record) => record.customerId === customerId && matches([record.name], search));
    },
    async findAccount(customerId, id) {
      const record = accounts.get(id);
      return record?.customerId === customerId ? record : null;
    },
    async saveAccount(account) { accounts.set(account.id, account); },
    async removeAccountForCompensation(customerId, id) { if (accounts.get(id)?.customerId === customerId) accounts.delete(id); },
    async listOpportunities(customerId, search) {
      return [...opportunities.values()].filter((record) => record.customerId === customerId && matches([record.name], search));
    },
    async findOpportunity(customerId, id) {
      const record = opportunities.get(id);
      return record?.customerId === customerId ? record : null;
    },
    async saveOpportunity(opportunity) { opportunities.set(opportunity.id, opportunity); },
    async removeOpportunityForCompensation(customerId, id) { if (opportunities.get(id)?.customerId === customerId) opportunities.delete(id); },
    async listContacts(customerId, opportunityId) {
      return [...contacts.values()].filter((record) => record.customerId === customerId && (!opportunityId || record.opportunityId === opportunityId));
    },
    async findContact(customerId, id) {
      const record = contacts.get(id);
      return record?.customerId === customerId ? record : null;
    },
    async saveContact(contact) { contacts.set(contact.id, contact); },
    async removeContactForCompensation(customerId, id) { if (contacts.get(id)?.customerId === customerId) contacts.delete(id); },
  };
}
