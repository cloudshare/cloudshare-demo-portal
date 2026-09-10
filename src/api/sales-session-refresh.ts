import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesDelivery } from "@/integrations/cloudshare/sales-delivery";
import type { CloudShareSalesExperienceStatus } from "@/domain/sales-session-status";
import { randomUUID } from "node:crypto";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { projectCloudShareFailureEvidence } from "@/integrations/cloudshare/diagnostic-failure-projection";

export async function handleRefreshSalesSessions(deps: { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "listForRefresh" | "recordExperienceObservations" | "recordExperienceObservation">; readonly delivery: Pick<SalesDelivery, "listSessions">; readonly diagnostics?: DiagnosticRecorder }, input: { readonly customerId: string; readonly mode: "automatic" | "manual"; readonly offset: number; readonly limit: number; readonly targetIds?: readonly string[] }) {
  if (!Number.isInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || (input.targetIds && (input.targetIds.length > 50 || input.targetIds.some((id) => typeof id !== "string" || id.length < 1 || id.length > 100)))) return { status: 400, body: { error: "Invalid bounded refresh pagination." } };
  if (!deps.sessions.list || (!deps.sessions.recordExperienceObservations && !deps.sessions.recordExperienceObservation)) return { status: 503, body: { error: "Sales Session refresh is unavailable." } };
  const correlationId = randomUUID();
  const exchanges: Array<{ readonly request?: Record<string, unknown>; readonly response?: Record<string, unknown> }> = [];
  try {
    let local;
    try { local = deps.sessions.listForRefresh ? await deps.sessions.listForRefresh(input.customerId, { targetIds: input.targetIds ?? [], offset: input.offset, limit: input.limit }) : await deps.sessions.list!(input.customerId); }
    catch (error) {
      await deps.diagnostics?.record({ source: "sales-session-refresh", operation: "sales.demo_session.refresh", outcome: "failure", level: "error", customerId: input.customerId, subject: { type: "sales_demo_session", id: "queue" }, message: "Certalis could not read the targeted Sales Sessions.", correlationId, details: { integrationSurface: "certalis.persistence", failureMode: "local_observation_read", error: error instanceof Error ? error.message : String(error) } });
      return { status: 500, body: { error: "Certalis could not read the targeted Sales Sessions. Retry or open Support Diagnostics.", durable: true, correlationId } };
    }
    // Provider pagination is independent from Certalis queue pagination. Read one
    // bounded provider page, then target only the locally rendered Customer rows.
    const requestedIds = new Set(input.targetIds ?? []);
    const renderedLocal = local.filter((session) => requestedIds.has(session.id));
    const rendered = new Set(renderedLocal.map((session) => session.cloudShareSalesExperienceId));
    const stale = input.mode === "automatic" ? new Set(renderedLocal.filter((session) => !session.experienceStatusObservedAt || Date.now() - session.experienceStatusObservedAt.getTime() > 300000).map((session) => session.cloudShareSalesExperienceId)) : rendered;
    if (stale.size === 0) return { status: 200, body: { rows: [], total: 0, progress: { state: "complete", message: "No rendered Sales Sessions need a CloudShare refresh." } } };
    const providerRows: { id: string; status: "notStarted" | "inProgress" | "ended" }[] = [];
    const seenProviderIds = new Set<string>();
    const providerField = [...stale].map((id) => `\"${id.replaceAll('"', '')}\"`).join(",");
    for (let page = 0; page < 10 && providerRows.filter((row) => stale.has(row.id)).length < stale.size; page += 1) {
      const result = await deps.delivery.listSessions({ field: `id=in(${providerField})`, offset: page * 100, limit: 100 });
      exchanges.push(result as unknown as { readonly request?: Record<string, unknown>; readonly response?: Record<string, unknown> });
      for (const row of result.sessions) {
        if (!row || typeof row.id !== "string" || !row.id || !["notStarted", "inProgress", "ended"].includes(row.status)) {
          throw new Error("CloudShare returned a malformed Sales Experience row.");
        }
        if (seenProviderIds.has(row.id)) throw new Error("CloudShare returned duplicate Sales Experience IDs.");
        seenProviderIds.add(row.id); providerRows.push(row);
      }
      if (result.sessions.length < 100) break;
    }
    const rows = providerRows.filter((row) => stale.has(row.id)).map((row) => {
      const match = rendered.has(row.id) ? local.find((session) => session.cloudShareSalesExperienceId === row.id) : undefined;
      return match ? { id: match.id, status: row.status } : null;
    }).filter((row): row is { id: string; status: CloudShareSalesExperienceStatus } => row !== null);
    if (rows.length < stale.size) { await deps.diagnostics?.record({ source: "sales-session-refresh", operation: "sales.demo_session.refresh", outcome: "failure", level: "warn", customerId: input.customerId, subject: { type: "sales_demo_session", id: "queue" }, message: "CloudShare did not return every targeted Sales Session.", correlationId, request: exchanges.at(-1)?.request, response: exchanges.at(-1)?.response, details: { integrationSurface: "cloudshare.v4.sales", failureMode: "incomplete_target_coverage", exchanges } }); return { status: 502, body: { error: "CloudShare did not return every targeted Sales Session. Retry or open Support Diagnostics.", durable: true, correlationId } }; }
    try {
      if (deps.sessions.recordExperienceObservations) await deps.sessions.recordExperienceObservations(input.customerId, rows.map((row) => ({ id: row.id, experienceStatus: row.status, experienceStatusObservedAt: new Date() })));
      else for (const row of rows) await deps.sessions.recordExperienceObservation!(input.customerId, row.id, { experienceStatus: row.status, experienceStatusObservedAt: new Date() });
    } catch (error) {
      await deps.diagnostics?.record({ source: "sales-session-refresh", operation: "sales.demo_session.refresh", outcome: "failure", level: "error", customerId: input.customerId, subject: { type: "sales_demo_session", id: "queue" }, message: "CloudShare observations were read, but Certalis could not persist them.", correlationId, request: exchanges.at(-1)?.request, response: exchanges.at(-1)?.response, details: { integrationSurface: "certalis.persistence", failureMode: "local_observation_persistence", error: error instanceof Error ? error.message : String(error), exchanges } });
      return { status: 500, body: { error: "CloudShare was read, but Certalis could not persist the observations. Retry or open Support Diagnostics.", durable: true, correlationId } };
    }
    await deps.diagnostics?.record({ source: "sales-session-refresh", operation: "sales.demo_session.refresh", outcome: "success", level: "info", customerId: input.customerId, subject: { type: "sales_demo_session", id: "queue" }, message: "CloudShare Sales Session status refreshed.", correlationId, request: exchanges.at(-1)?.request, response: exchanges.at(-1)?.response, details: { mode: input.mode, targetCount: stale.size, observedCount: rows.length, integrationSurface: "cloudshare.v4.sales", exchanges } });
    return { status: 200, body: { rows: rows.map(({ id, status }) => ({ id, status })), total: rows.length, progress: { state: "complete", message: "Sales Session status refreshed." }, observation: { source: "cloudshare_v4_sales_list", freshness: "fresh", correlation: correlationId } } };
  } catch (error) {
    const structured = error instanceof Error && "context" in error ? (error as Error & { context?: Record<string, unknown> }).context : undefined;
    const failureEvidence = projectCloudShareFailureEvidence(error);
    const request = failureEvidence ? failureEvidence.request : exchanges.at(-1)?.request ?? undefined;
    const response = failureEvidence ? failureEvidence.response : exchanges.at(-1)?.response ?? undefined;
    await deps.diagnostics?.record({ source: "sales-session-refresh", operation: "sales.demo_session.refresh", outcome: "failure", level: "warn", customerId: input.customerId, subject: { type: "sales_demo_session", id: "queue" }, message: "CloudShare Sales Session refresh failed.", correlationId, request, response, details: { integrationSurface: "cloudshare.v4.sales", exchanges, failureMode: typeof structured?.failureMode === "string" ? structured.failureMode : error instanceof Error ? error.name : "provider_failure" } });
    return { status: 502, body: { error: "CloudShare Sales Session refresh failed. Retry or open Support Diagnostics.", durable: true, correlationId } };
  }
}
