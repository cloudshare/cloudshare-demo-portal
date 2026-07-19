import type { DiagnosticActor } from "@/domain/diagnostic-log";
import { buildOperationalSalesSessions, type SalesSessionStatusFilter } from "@/domain/sales-session-operations";
import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";
import type { SalesRecordRepository } from "@/domain/sales-records";

const experienceStatuses = new Set(["notStarted", "inProgress", "ended"] as const);
const operationStatuses = new Set(["provisioning", "correlated", "needs_attention"] as const);
type LegacyLifecycle = "all" | "upcoming" | "in_progress" | "ended" | "provisioning" | "needs_attention";
const legacyLifecycles = new Set<LegacyLifecycle>(["all", "upcoming", "in_progress", "ended", "provisioning", "needs_attention"]);

export interface SalesSessionOperationsDeps { readonly sessions: Pick<SalesDemoSessionRepository, "list" | "listByAccount">; readonly records?: Pick<SalesRecordRepository, "findOpportunity">; readonly now?: () => Date; }
export interface SalesSessionOperationsRequest { readonly customerId: string; readonly actor: DiagnosticActor; readonly experienceStatus?: string | null; readonly operationStatus?: string | null; /** Compatibility only; new callers use the dimension-specific filters. */ readonly lifecycle?: string | null; readonly accountId?: string | null; readonly opportunityId?: string | null; }

/** Browser-safe, customer-scoped operational list. CloudShare experience IDs
 * never cross this seam; support diagnostics retain that evidence server-side. */
export async function handleListSalesSessionOperations(deps: SalesSessionOperationsDeps, request: SalesSessionOperationsRequest) {
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

function parseStatusFilter(request: Pick<SalesSessionOperationsRequest, "experienceStatus" | "operationStatus" | "lifecycle">): SalesSessionStatusFilter | { readonly error: string } {
  if (request.experienceStatus && !experienceStatuses.has(request.experienceStatus as never)) return { error: "Unknown CloudShare Experience status filter." };
  if (request.operationStatus && !operationStatuses.has(request.operationStatus as never)) return { error: "Unknown Certalis operation status filter." };
  if (request.experienceStatus || request.operationStatus) return {
    ...(request.experienceStatus ? { experience: request.experienceStatus as SalesSessionStatusFilter["experience"] } : {}),
    ...(request.operationStatus ? { operation: request.operationStatus as SalesSessionStatusFilter["operation"] } : {}),
  };
  if (!request.lifecycle || request.lifecycle === "all") return {};
  if (!legacyLifecycles.has(request.lifecycle as LegacyLifecycle)) return { error: "Unknown legacy session lifecycle filter." };
  return request.lifecycle === "upcoming" ? { experience: "notStarted" }
    : request.lifecycle === "in_progress" ? { experience: "inProgress" }
      : request.lifecycle === "ended" ? { experience: "ended" }
        : request.lifecycle === "provisioning" ? { operation: "provisioning" }
          : { operation: "needs_attention" };
}
