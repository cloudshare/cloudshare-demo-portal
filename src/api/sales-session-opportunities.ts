import type { SalesRecordRepository } from "@/domain/sales-records";
export async function handleListSalesSessionOpportunities(deps: { records: Pick<SalesRecordRepository, "listAccounts" | "listOpportunities"> }, request: { customerId: string; accountId?: string | null; search?: string | null; page?: string | null; pageSize?: string | null }) {
  const page = Math.max(1, Number(request.page ?? "1") || 1); const pageSize = Math.min(50, Math.max(1, Number(request.pageSize ?? "20") || 20));
  const [accounts, opportunities] = await Promise.all([deps.records.listAccounts(request.customerId, request.search ?? undefined), deps.records.listOpportunities(request.customerId, request.search ?? undefined)]);
  const names = new Map(accounts.filter((account) => !account.archivedAt).map((account) => [account.id, account.name]));
  const matching = opportunities.filter((opportunity) => !opportunity.archivedAt && names.has(opportunity.accountId) && (!request.accountId || opportunity.accountId === request.accountId) && (!request.search || `${names.get(opportunity.accountId)} ${opportunity.name}`.toLowerCase().includes(request.search.toLowerCase())));
  return { status: 200, body: { accounts: [...names.entries()].map(([id, name]) => ({ id, name })), opportunities: matching.slice((page - 1) * pageSize, page * pageSize).map((opportunity) => ({ id: opportunity.id, accountId: opportunity.accountId, label: `${names.get(opportunity.accountId)} - ${opportunity.name}` })), page, pageSize, total: matching.length } };
}
