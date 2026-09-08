import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import { createSalesSessionRefresh } from "@/domain/sales-session-refresh";
import type { SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import type { CloudShareSalesExperienceStatus } from "@/domain/sales-session-status";

export async function handleRefreshSalesSessions(deps: { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "findById" | "recordExperienceObservation">; readonly delivery: Pick<SalesDelivery, "listSessions" | "readSession"> }, input: { readonly customerId: string; readonly mode: "automatic" | "manual"; readonly offset: number; readonly limit: number }) {
  if (!Number.isInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return { status: 400, body: { error: "Invalid bounded refresh pagination." } };
  if (!deps.sessions.list || !deps.sessions.findById || !deps.sessions.recordExperienceObservation) return { status: 503, body: { error: "Sales Session refresh is unavailable." } };
  try {
    const local = await deps.sessions.list(input.customerId);
    // Provider pagination is independent from Certalis queue pagination. Read one
    // bounded provider page, then target only the locally rendered Customer rows.
    const renderedLocal = local.slice(input.offset, input.offset + input.limit);
    const rendered = new Set(renderedLocal.map((session) => session.cloudShareSalesExperienceId));
    const stale = input.mode === "automatic" ? new Set(renderedLocal.filter((session) => !session.experienceStatusObservedAt || Date.now() - session.experienceStatusObservedAt.getTime() > 300000).map((session) => session.cloudShareSalesExperienceId)) : rendered;
    const providerRows: { id: string; status: "notStarted" | "inProgress" | "ended" }[] = [];
    const providerField = [...stale].map((id) => `\"${id.replaceAll('"', '')}\"`).join(",");
    for (let page = 0; page < 10 && providerRows.filter((row) => stale.has(row.id)).length < stale.size; page += 1) {
      const result = await deps.delivery.listSessions({ field: `id=in(${providerField})`, offset: page * 100, limit: 100 });
      providerRows.push(...result.sessions);
      if (result.sessions.length < 100) break;
    }
    const rows = providerRows.filter((row) => stale.has(row.id)).map((row) => {
      const match = rendered.has(row.id) ? local.find((session) => session.cloudShareSalesExperienceId === row.id) : undefined;
      return match ? { id: match.id, status: row.status } : null;
    }).filter((row): row is { id: string; status: CloudShareSalesExperienceStatus } => row !== null);
    await Promise.all(rows.map((row) => deps.sessions.recordExperienceObservation!(input.customerId, row.id, { experienceStatus: row.status, experienceStatusObservedAt: new Date() })));
    return { status: 200, body: { rows: rows.map(({ id, status }) => ({ id, status })), total: rows.length, progress: { state: "complete", message: "Sales Session status refreshed." }, observation: { source: "cloudshare_v4_sales_list", freshness: "fresh", correlation: "server-side" } } };
  } catch {
    return { status: 502, body: { error: "CloudShare Sales Session refresh failed. Retry or open Support Diagnostics.", durable: true } };
  }
}
