import type { Logger } from "@/observability/logger";
import { syncResources, type CloudShareResourceLister, type ResourceRepository } from "@/domain/resource-sync";
import type { AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type { SupportLogRepository } from "@/domain/support-log";

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
  readonly lister: CloudShareResourceLister;
  readonly resources: ResourceRepository;
  readonly logger: Logger;
}

export async function handleSyncResources(
  deps: SyncHandlerDeps,
  _request: Record<string, unknown>,
): Promise<AdminResponse> {
  try {
    const result = await syncResources({ lister: deps.lister, repository: deps.resources });
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
