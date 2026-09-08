import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { createSalesSessionRefresh } from "@/domain/sales-session-refresh";
import type { SalesDelivery } from "@/integrations/cloudshare/sales-delivery";

export async function handleRefreshSalesSessions(deps: { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "findById" | "recordExperienceObservation">; readonly delivery: Pick<SalesDelivery, "listSessions" | "readSession"> }, input: { readonly customerId: string; readonly mode: "automatic" | "manual"; readonly offset: number; readonly limit: number }) {
  if (!Number.isInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return { status: 400, body: { error: "Invalid bounded refresh pagination." } };
  if (!deps.sessions.list || !deps.sessions.findById || !deps.sessions.recordExperienceObservation) return { status: 503, body: { error: "Sales Session refresh is unavailable." } };
  try {
    const local = await deps.sessions.list(input.customerId);
    const refresh = createSalesSessionRefresh({ listSessions: deps.delivery.listSessions, readSession: deps.delivery.readSession, sessions: { findById: deps.sessions.findById, updateOperationalState: deps.sessions.updateOperationalState } });
    // Provider pagination is independent from Certalis queue pagination. Read one
    // bounded provider page, then target only the locally rendered Customer rows.
    const result = await refresh.refreshQueue({ ...input, offset: 0, limit: 100 });
    const rendered = new Set(local.slice(input.offset, input.offset + input.limit).map((session) => session.cloudShareSalesExperienceId));
    const rows = result.rows.map((row) => {
      const match = rendered.has(row.id) ? local.find((session) => session.cloudShareSalesExperienceId === row.id) : undefined;
      return match ? { id: match.id, status: row.status } : null;
    }).filter((row): row is { id: string; status: typeof result.rows[number]["status"] } => row !== null);
    await Promise.all(rows.map((row) => deps.sessions.recordExperienceObservation!(input.customerId, row.id, { experienceStatus: row.status, experienceStatusObservedAt: new Date() })));
    return { status: 200, body: { rows: rows.map(({ id, status }) => ({ id, status })), total: result.total, progress: result.progress, observation: { source: "cloudshare_v4_sales_list", freshness: "fresh", correlation: "server-side" } } };
  } catch {
    return { status: 502, body: { error: "CloudShare Sales Session refresh failed. Retry or open Support Diagnostics.", durable: true } };
  }
}
