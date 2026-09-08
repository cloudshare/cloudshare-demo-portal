import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { createSalesSessionRefresh } from "@/domain/sales-session-refresh";
import type { SalesDelivery } from "@/integrations/cloudshare/sales-delivery";

export async function handleRefreshSalesSessions(deps: { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "findById" | "updateOperationalState">; readonly delivery: Pick<SalesDelivery, "listSessions" | "readSession"> }, input: { readonly customerId: string; readonly mode: "automatic" | "manual"; readonly offset: number; readonly limit: number }) {
  if (!Number.isInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return { status: 400, body: { error: "Invalid bounded refresh pagination." } };
  if (!deps.sessions.list || !deps.sessions.findById || !deps.sessions.updateOperationalState) return { status: 503, body: { error: "Sales Session refresh is unavailable." } };
  try {
    const local = await deps.sessions.list(input.customerId);
    const refresh = createSalesSessionRefresh({ listSessions: deps.delivery.listSessions, readSession: deps.delivery.readSession, sessions: { findById: deps.sessions.findById, updateOperationalState: deps.sessions.updateOperationalState } });
    const result = await refresh.refreshQueue(input);
    const rows = result.rows.map((row) => {
      const match = local.find((session) => session.cloudShareSalesExperienceId === row.id);
      return match ? { id: match.id, status: row.status, operationalStatus: match.operationalStatus ?? "active" } : null;
    }).filter((row): row is { id: string; status: typeof result.rows[number]["status"]; operationalStatus: string } => row !== null);
    await Promise.all(rows.map((row) => deps.sessions.updateOperationalState!(input.customerId, row.id, { operationalStatus: row.operationalStatus === "needs_attention" ? "needs_attention" : row.operationalStatus === "provisioning" ? "provisioning" : "active", experienceStatus: row.status, experienceStatusObservedAt: new Date() })));
    return { status: 200, body: { rows: rows.map(({ id, status }) => ({ id, status })), total: result.total, progress: result.progress, observation: { source: "cloudshare_v4_sales_list", freshness: "fresh", correlation: "server-side" } } };
  } catch {
    return { status: 502, body: { error: "CloudShare Sales Session refresh failed. Retry or open Support Diagnostics.", durable: true } };
  }
}
