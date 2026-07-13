import type { AuditRecord } from "./audit-trail";
import type { DiagnosticLogEntryInput } from "./diagnostic-log";
import type { OpportunityContact, SalesAccount, SalesOpportunity } from "./sales-records";

export type SalesMutationRecord =
  | { readonly type: "account"; readonly value: SalesAccount }
  | { readonly type: "opportunity"; readonly value: SalesOpportunity }
  | { readonly type: "opportunity_contact"; readonly value: OpportunityContact };

/**
 * Verifies the parent is still active within the same transaction as the child
 * mutation. The denial evidence is supplied up front so a rejected mutation is
 * still fully auditable without a follow-up write.
 */
export interface ActiveSalesParentGuard {
  readonly type: "account" | "opportunity";
  readonly id: string;
  readonly customerId: string;
  readonly deniedAudit: AuditRecord;
  readonly deniedDiagnostic: DiagnosticLogEntryInput;
}

export type SalesMutationCommitResult = { readonly outcome: "committed" } | { readonly outcome: "parent_archived" };

/** Commits the local record and its two append-only evidence rows as one durable operation. */
export interface SalesMutationWriter {
  commit(input: {
    readonly record?: SalesMutationRecord;
    readonly audit: AuditRecord;
    readonly diagnostic: DiagnosticLogEntryInput;
    readonly activeParentGuard?: ActiveSalesParentGuard;
  }): Promise<SalesMutationCommitResult>;
}
