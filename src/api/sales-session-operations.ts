import type { DiagnosticActor } from "@/domain/diagnostic-log";
import { buildOperationalSalesSessions, type SalesSessionLifecycle } from "@/domain/sales-session-operations";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";

const allowed = new Set<SalesSessionLifecycle>(["all", "upcoming", "in_progress", "ended", "provisioning", "needs_attention"]);

export interface SalesSessionOperationsDeps { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "listByAccount">; readonly records?: Pick<SalesRecordRepository, "findOpportunity">; readonly now?: () => Date; }
export interface SalesSessionOperationsRequest { readonly customerId: string; readonly actor: DiagnosticActor; readonly lifecycle?: string | null; readonly accountId?: string | null; readonly opportunityId?: string | null; }

/** Browser-safe, customer-scoped operational list. CloudShare experience IDs
 * never cross this seam; support diagnostics retain that evidence server-side. */
export async function handleListSalesSessionOperations(deps: SalesSessionOperationsDeps, request: SalesSessionOperationsRequest) {
  const lifecycle = request.lifecycle && allowed.has(request.lifecycle as SalesSessionLifecycle) ? request.lifecycle as SalesSessionLifecycle : "all";
  if (request.lifecycle && lifecycle === "all" && request.lifecycle !== "all") return { status: 400, body: { error: "Unknown session lifecycle filter." } };
  if (!deps.sessions.list) return { status: 503, body: { error: "The Sales Session operations read model is unavailable." } };
  const rawSessions = request.accountId && deps.sessions.listByAccount
    ? await deps.sessions.listByAccount(request.customerId, request.accountId)
    : await deps.sessions.list(request.customerId);
  const sessions = buildOperationalSalesSessions(rawSessions, (deps.now ?? (() => new Date()))(), lifecycle);
  const permittedOpportunityIds = request.accountId && !deps.sessions.listByAccount && deps.records
    ? new Set((await Promise.all(sessions.map(async (session) => (await deps.records?.findOpportunity(request.customerId, session.opportunityId))?.accountId === request.accountId ? session.opportunityId : null))).filter((id): id is string => id !== null))
    : null;
  const filtered = sessions.filter((session) => (!request.opportunityId || session.opportunityId === request.opportunityId) && (!permittedOpportunityIds || permittedOpportunityIds.has(session.opportunityId)));
  return { status: 200, body: { sessions: filtered } };
}
