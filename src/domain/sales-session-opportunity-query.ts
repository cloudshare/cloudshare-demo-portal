export interface SalesSessionOpportunityOption { readonly id: string; readonly accountId: string; readonly label: string; }
export interface SalesSessionOpportunityPage { readonly accounts: readonly { id: string; name: string }[]; readonly opportunities: readonly SalesSessionOpportunityOption[]; readonly page: number; readonly pageSize: number; readonly total: number; }
export interface SalesSessionOpportunityQuery { list(customerId: string, query: { accountId?: string; search?: string; page: number; pageSize: number }): Promise<SalesSessionOpportunityPage>; }
