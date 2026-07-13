import type { AuditRecord } from "./audit-trail";
import type { DiagnosticLogEntryInput } from "./diagnostic-log";
import type { OpportunityContact, SalesAccount, SalesOpportunity } from "./sales-records";

export type SalesMutationRecord =
  | { readonly type: "account"; readonly value: SalesAccount }
  | { readonly type: "opportunity"; readonly value: SalesOpportunity }
  | { readonly type: "opportunity_contact"; readonly value: OpportunityContact };

/** Commits the local record and its two append-only evidence rows as one durable operation. */
export interface SalesMutationWriter {
  commit(input: {
    readonly record?: SalesMutationRecord;
    readonly audit: AuditRecord;
    readonly diagnostic: DiagnosticLogEntryInput;
  }): Promise<void>;
}
