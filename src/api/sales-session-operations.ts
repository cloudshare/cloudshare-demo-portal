import type { DiagnosticActor } from "@/domain/diagnostic-log";
import { buildOperationalSalesSessions, type SalesSessionStatusFilter } from "@/domain/sales-session-operations";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";

const experienceStatuses = new Set(["notStarted", "inProgress", "ended"] as const);
const operationStatuses = new Set(["provisioning", "correlated", "needs_attention"] as const);

export interface SalesSessionOperationsDeps { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "listByAccount">; readonly records?: Pick<SalesRecordRepository, "findOpportunity">; readonly now?: () => Date; }
export interface SalesSessionOperationsRequest { readonly customerId: string; readonly actor: DiagnosticActor; readonly experienceStatus?: string | null; readonly operationStatus?: string | null; readonly accountId?: string | null; readonly opportunityId?: string | null; }

/** Browser-safe, customer-scoped operational list. CloudShare experience IDs
 * never cross this seam; support diagnostics retain that evidence server-side. */
export async function handleListSalesSessionOperations(deps: SalesSessionOperationsDeps, request: SalesSessionOperationsRequest) {
  if (hasRetiredLifecycle(request)) return { status: 400, body: { error: "Use the separate Certalis operation or CloudShare Experience status filter." } };
  const filter = parseStatusFilter(request);
  if ("error" in filter) return { status: 400, body: { error: filter.error } };
  if (!deps.sessions.list) return { status: 503, body: { error: "The Sales Session operations read model is unavailable." } };
  const rawSessions = request.accountId && deps.sessions.listByAccount
    ? await deps.sessions.listByAccount(request.customerId, request.accountId)
    : await deps.sessions.list(request.customerId);
  const sessions = buildOperationalSalesSessions(rawSessions, (deps.now ?? (() => new Date()))(), filter);
  const permittedOpportunityIds = request.accountId && !deps.sessions.listByAccount && deps.records
    ? new Set((await Promise.all(sessions.map(async (session) => (await deps.records?.findOpportunity(request.customerId, session.opportunityId))?.accountId === request.accountId ? session.opportunityId : null))).filter((id): id is string => id !== null))
    : null;
  const filtered = sessions.filter((session) => (!request.opportunityId || session.opportunityId === request.opportunityId) && (!permittedOpportunityIds || permittedOpportunityIds.has(session.opportunityId)));
  return { status: 200, body: { sessions: filtered } };
}

function parseStatusFilter(request: Pick<SalesSessionOperationsRequest, "experienceStatus" | "operationStatus">): SalesSessionStatusFilter | { readonly error: string } {
  if (request.experienceStatus && !experienceStatuses.has(request.experienceStatus as never)) return { error: "Unknown CloudShare Experience status filter." };
  if (request.operationStatus && !operationStatuses.has(request.operationStatus as never)) return { error: "Unknown Certalis operation status filter." };
  return {
    ...(request.experienceStatus ? { experience: request.experienceStatus as SalesSessionStatusFilter["experience"] } : {}),
    ...(request.operationStatus ? { operation: request.operationStatus as SalesSessionStatusFilter["operation"] } : {}),
  };
}

function hasRetiredLifecycle(request: SalesSessionOperationsRequest): boolean {
  return Object.prototype.hasOwnProperty.call(request, "lifecycle") && (request as SalesSessionOperationsRequest & { readonly lifecycle?: unknown }).lifecycle != null;
}
