import type { Logger } from "@/observability/logger";
import { syncResources, type CloudShareResourceLister, type ResourceRepository } from "@/domain/resource-sync";
import type { AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type { SupportLogRepository } from "@/domain/support-log";
import type {
  DiagnosticLogEntry,
  DiagnosticLogRepository,
} from "@/domain/diagnostic-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { createCloudShareResourceLister } from "@/integrations/cloudshare/resources";

/**
 * Framework-agnostic admin API handlers. All three surfaces are read-only
 * (audit trail, event log) or safe-to-replay (sync resources). Secrets are
 * never surfaced — the logger's redaction and the absence of raw config fields
 * in the responses enforce this.
 *
 * HTTP contracts:
 *  GET /api/admin/audit   — ?examAttemptId=<id> (optional) → 200 { records }
 *  GET /api/admin/events  — 200 { events }
 *  POST /api/admin/sync-resources — 200 { synced, byType } | 502
 */

// --- Types ---

export interface AdminRequest {
  readonly query: Record<string, string | undefined>;
}

export interface AdminResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

// --- Audit trail ---

export interface AuditHandlerDeps {
  readonly audit: AuditRepository;
  readonly logger: Logger;
}

export async function handleGetAuditTrail(
  deps: AuditHandlerDeps,
  request: AdminRequest,
): Promise<AdminResponse> {
  const examAttemptId = request.query.examAttemptId?.trim();
  const records = examAttemptId
    ? await deps.audit.listByExamAttemptId(examAttemptId)
    : await deps.audit.listAll();

  return { status: 200, body: { records } };
}

// --- Sync resources ---

export interface SyncHandlerDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly resources: ResourceRepository;
  readonly logger: Logger;
}

export async function handleSyncResources(
  deps: SyncHandlerDeps,
  request: { customerId: string },
): Promise<AdminResponse> {
  try {
    const connection = await deps.connections.findByCustomerId(request.customerId);
    if (!connection) {
      return {
        status: 404,
        body: { error: "Save a CloudShare Connection before syncing resources." },
      };
    }

    const lister: CloudShareResourceLister = createCloudShareResourceLister(
      deps.cloudshare.forConnection(connection),
    );
    const result = await syncResources({ lister, repository: deps.resources });
    deps.logger.info("resources synced", { synced: result.synced });
    return {
      status: 200,
      body: {
        synced: result.synced,
        byType: Object.fromEntries(
          Object.entries(result.byType).map(([type, mappings]) => [
            type,
            mappings.map((m) => ({ name: m.name, cloudshareId: m.cloudshareId, syncedAt: m.syncedAt })),
          ]),
        ),
      },
    };
  } catch (err) {
    deps.logger.error("resource sync failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 502, body: { error: "resource sync failed" } };
  }
}

// --- Event log ---

export interface EventLogHandlerDeps {
  readonly eventLog: EventLogRepository;
  readonly logger: Logger;
}

export async function handleGetEventLog(
  deps: EventLogHandlerDeps,
  request: AdminRequest,
): Promise<AdminResponse> {
  const limitParam = request.query.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const events = await deps.eventLog.listAll(limit !== undefined && !isNaN(limit) ? limit : undefined);
  return { status: 200, body: { events } };
}

// --- Support log ---

export interface SupportLogHandlerDeps {
  readonly supportLog: SupportLogRepository;
  readonly logger: Logger;
}

export async function handleGetSupportLog(
  deps: SupportLogHandlerDeps,
  request: AdminRequest,
): Promise<AdminResponse> {
  const limitParam = request.query.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const records = await deps.supportLog.listAll(limit !== undefined && !isNaN(limit) ? limit : undefined);
  return { status: 200, body: { records } };
}

// --- Diagnostic log (typed support source of truth, ADR-004) ---

export interface DiagnosticLogHandlerDeps {
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

/**
 * Read the typed diagnostic log for one Customer. Customer scoping is enforced
 * server-side: the caller passes the authenticated admin's `customerId`, never a
 * client-supplied one, so admins only ever see their own Customer's entries.
 * Reads are always bounded (default + hard cap) and filterable by time range.
 */
export async function handleGetDiagnosticLog(
  deps: DiagnosticLogHandlerDeps,
  request: AdminRequest & { customerId: string },
): Promise<AdminResponse> {
  const from = parseDate(request.query.from);
  const to = parseDate(request.query.to);
  const examAttemptId = request.query.examAttemptId?.trim();
  const limitParam = request.query.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  const entries = await deps.diagnostics.query({
    customerId: request.customerId,
    ...(examAttemptId ? { examAttemptId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(limit !== undefined && !Number.isNaN(limit) ? { limit } : {}),
  });

  return { status: 200, body: { entries: entries.map(serialiseDiagnosticEntry) } };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function serialiseDiagnosticEntry(entry: DiagnosticLogEntry): Record<string, unknown> {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    level: entry.level,
    source: entry.source,
    operation: entry.operation,
    outcome: entry.outcome,
    customerId: entry.customerId,
    actor: entry.actor,
    subject: entry.subject,
    message: entry.message,
    correlationId: entry.correlationId,
    candidateEmail: entry.candidateEmail,
    examId: entry.examId,
    examAttemptId: entry.examAttemptId,
    externalIds: entry.externalIds,
    request: entry.request,
    response: entry.response,
    details: entry.details,
  };
}
