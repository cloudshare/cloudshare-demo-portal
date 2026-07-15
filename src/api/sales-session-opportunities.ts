import type { SalesSessionOpportunityQuery } from "@/domain/sales-session-opportunity-query";
export async function handleListSalesSessionOpportunities(deps: { query: SalesSessionOpportunityQuery }, request: { customerId: string; accountId?: string | null; search?: string | null; page?: string | null; pageSize?: string | null }) {
  const page = Math.max(1, Number(request.page ?? "1") || 1); const pageSize = Math.min(50, Math.max(1, Number(request.pageSize ?? "20") || 20));
  return { status: 200, body: await deps.query.list(request.customerId, { accountId: request.accountId ?? undefined, search: request.search ?? undefined, page, pageSize }) };
}
