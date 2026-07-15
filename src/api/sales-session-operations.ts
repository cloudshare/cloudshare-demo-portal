import type { DiagnosticActor } from "@/domain/diagnostic-log";
import { buildOperationalSalesSessions, type SalesSessionLifecycle } from "@/domain/sales-session-operations";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";

const allowed = new Set<SalesSessionLifecycle>(["all", "upcoming", "in_progress", "ended", "provisioning", "needs_attention"]);

export interface SalesSessionOperationsDeps { readonly sessions: Pick<SalesDemoSessionRepository, "list">; readonly now?: () => Date; }
export interface SalesSessionOperationsRequest { readonly customerId: string; readonly actor: DiagnosticActor; readonly lifecycle?: string | null; readonly opportunityId?: string | null; }

/** Browser-safe, customer-scoped operational list. CloudShare experience IDs
 * never cross this seam; support diagnostics retain that evidence server-side. */
export async function handleListSalesSessionOperations(deps: SalesSessionOperationsDeps, request: SalesSessionOperationsRequest) {
  const lifecycle = request.lifecycle && allowed.has(request.lifecycle as SalesSessionLifecycle) ? request.lifecycle as SalesSessionLifecycle : "all";
  if (request.lifecycle && lifecycle === "all" && request.lifecycle !== "all") return { status: 400, body: { error: "Unknown session lifecycle filter." } };
  if (!deps.sessions.list) return { status: 503, body: { error: "The Sales Session operations read model is unavailable." } };
  const sessions = buildOperationalSalesSessions(await deps.sessions.list(request.customerId), (deps.now ?? (() => new Date()))(), lifecycle)
    .filter((session) => !request.opportunityId || session.opportunityId === request.opportunityId);
  return { status: 200, body: { sessions } };
}
