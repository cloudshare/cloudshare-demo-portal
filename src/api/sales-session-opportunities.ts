import type { SalesSessionOpportunityQuery } from "@/domain/sales-session-opportunity-query";
export async function handleListSalesSessionOpportunities(deps: { query: SalesSessionOpportunityQuery }, request: { customerId: string; accountId?: string | null; accountSearch?: string | null; accountPage?: string | null; accountPageSize?: string | null; search?: string | null; selectedOpportunityId?: string | null; page?: string | null; pageSize?: string | null }) {
  const page = Math.max(1, Number(request.page ?? "1") || 1); const pageSize = Math.min(50, Math.max(1, Number(request.pageSize ?? "20") || 20));
  const accountPage = Math.max(1, Number(request.accountPage ?? "1") || 1); const accountPageSize = Math.min(50, Math.max(1, Number(request.accountPageSize ?? "20") || 20));
  return { status: 200, body: await deps.query.list(request.customerId, { accountId: request.accountId ?? undefined, accountSearch: request.accountSearch ?? undefined, accountPage, accountPageSize, search: request.search ?? undefined, selectedOpportunityId: request.selectedOpportunityId ?? undefined, page, pageSize }) };
}
