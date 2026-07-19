import type { Logger } from "@/observability/logger";
import { syncResources, type CloudShareResourceLister, type ResourceRepository } from "@/domain/resource-sync";
import type { AuditQuery, AuditRecord, AuditRepository } from "@/domain/audit-trail";
import type { EventLogRepository } from "@/domain/event-log";
import type {
  DiagnosticLogEntry,
  DiagnosticOutcome,
  DiagnosticLogEntryInput,
  DiagnosticRecorder,
  DiagnosticLogRepository,
} from "@/domain/diagnostic-log";
import { MAX_DIAGNOSTIC_QUERY_LIMIT } from "@/domain/diagnostic-log";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import {
  createCloudShareResourceLister,
  type CloudShareResourceReadFailure,
  type CloudShareResourceReadSuccess,
} from "@/integrations/cloudshare/resources";

/**
 * Framework-agnostic admin API handlers. All three surfaces are read-only
 * (audit trail, event log) or safe-to-replay (sync resources). Secrets are
 * never surfaced — the logger's redaction and the absence of raw config fields
 * in the responses enforce this.
 *
 * HTTP contracts:
 *  GET /api/admin/audit   — filterable, Customer-scoped audit records → 200 { records }
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

export interface AdminAuditServices {
  readonly audit: AuditRepository;
  readonly logger: Logger;
}

export function buildAdminAuditDeps(services: AdminAuditServices): AuditHandlerDeps {
  return {
    audit: services.audit,
    logger: services.logger,
  };
}

export async function handleGetAuditTrail(
  deps: AuditHandlerDeps,
  request: AdminRequest & { customerId: string },
): Promise<AdminResponse> {
  const records = await deps.audit.query(parseAuditQuery(request.customerId, request.query));

  return { status: 200, body: { records: records.map(serialiseAuditRecord) } };
}

function parseAuditQuery(
  customerId: string,
  query: Record<string, string | undefined>,
): AuditQuery {
  const limitParam = query.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  return {
    customerId,
    ...(normaliseQueryText(query.actorEmail)
      ? { actorEmail: normaliseQueryText(query.actorEmail)?.toLowerCase() }
      : {}),
    ...(normaliseQueryText(query.action) ? { action: normaliseQueryText(query.action) } : {}),
    ...(normaliseQueryText(query.subjectType)
      ? { subjectType: normaliseQueryText(query.subjectType) }
      : {}),
    ...(normaliseQueryText(query.subjectId) ? { subjectId: normaliseQueryText(query.subjectId) } : {}),
    ...(parseAuditOutcome(query.outcome) ? { outcome: parseAuditOutcome(query.outcome) } : {}),
    ...(normaliseQueryText(query.candidateEmail)
      ? { candidateEmail: normaliseQueryText(query.candidateEmail)?.toLowerCase() }
      : {}),
    ...(normaliseQueryText(query.examId) ? { examId: normaliseQueryText(query.examId) } : {}),
    ...(normaliseQueryText(query.examAttemptId)
      ? { examAttemptId: normaliseQueryText(query.examAttemptId) }
      : {}),
    ...(normaliseQueryText(query.correlationId)
      ? { correlationId: normaliseQueryText(query.correlationId) }
      : {}),
    ...(limit !== undefined && !Number.isNaN(limit) && Number.isFinite(limit)
      ? { limit: Math.min(Math.max(Math.floor(limit), 1), 200) }
      : { limit: 100 }),
  };
}

function normaliseQueryText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAuditOutcome(value: string | undefined): AuditRecord["outcome"] | undefined {
  return value === "success" || value === "failure" || value === "denied" ? value : undefined;
}

function serialiseAuditRecord(record: AuditRecord): Record<string, unknown> {
  return {
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    customerId: record.customerId,
    actorType: record.actorType,
    actorId: record.actorId,
    actorEmail: record.actorEmail,
    action: record.action,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    outcome: record.outcome,
    candidateId: record.candidateId,
    candidateEmail: record.candidateEmail,
    examId: record.examId,
    examAttemptId: record.examAttemptId,
    correlationId: record.correlationId,
    details: record.details,
    error: record.error,
  };
}

// --- Sync resources ---

export interface SyncHandlerDeps {
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly resources: ResourceRepository;
  readonly diagnostics?: DiagnosticRecorder;
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
      {
        onReadSuccess: async (spec) => {
          await safeRecordDiagnostic(deps, buildResourceReadSuccessEntry(request.customerId, spec));
        },
        onReadFailure: async (spec) => {
          await safeRecordDiagnostic(deps, buildResourceReadFailureEntry(request.customerId, spec));
        },
      },
    );
    const result = await syncResources({ lister, repository: deps.resources });
    await safeRecordDiagnostic(deps, {
      source: "admin",
      customerId: request.customerId,
      level: "info",
      operation: "cloudshare.resource_sync.legacy_sync.read",
      outcome: "success",
      message: "Legacy resource sync completed",
      request: { method: "POST", path: "/api/admin/sync-resources" },
      response: {
        synced: result.synced,
        resourceCounts: {
          project: result.byType.project.length,
          region: result.byType.region.length,
          blueprint: result.byType.blueprint.length,
          policy: result.byType.policy.length,
        },
      },
      externalIds: { resourceType: "resource_sync" },
    });
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
    await safeRecordDiagnostic(deps, {
      source: "admin",
      customerId: request.customerId,
      level: "warn",
      operation: "cloudshare.resource_sync.legacy_sync.read",
      outcome: "failure",
      message: "Legacy resource sync failed",
      request: { method: "POST", path: "/api/admin/sync-resources" },
      details: {
        failureMode: "resource_sync_failed",
      },
      externalIds: { resourceType: "resource_sync" },
    });
    deps.logger.error("resource sync failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 502, body: { error: "resource sync failed" } };
  }
}

function buildResourceReadSuccessEntry(
  customerId: string,
  spec: CloudShareResourceReadSuccess,
): DiagnosticLogEntryInput {
  return {
    source: "admin",
    customerId,
    level: "info",
    operation: spec.operation,
    outcome: "success",
    message: `${spec.resourceType} resource read succeeded`,
    request: spec.request ?? { method: "GET", path: spec.path },
    response: spec.response,
    details: { integrationSurface: spec.integrationSurface },
    externalIds: { resourceType: spec.resourceType, ...(spec.resourceIds ?? {}) },
  };
}

function buildResourceReadFailureEntry(
  customerId: string,
  spec: CloudShareResourceReadFailure,
): DiagnosticLogEntryInput {
  const cloudShareError = asCloudShareErrorLike(spec.error);
  const diagnostic = cloudShareError
    ? buildCloudShareFailureDiagnostic(cloudShareError)
    : { method: "GET", failureMode: "resource_sync_failed", responseStatus: undefined };

  return {
    source: "admin",
    customerId,
    level: "warn",
    operation: spec.operation,
    outcome: "failure",
    message: `${spec.resourceType} resource read failed`,
    request: {
      method: diagnostic.method,
      path: spec.path,
      ...(cloudShareError?.context?.requestHeaders
        ? { headers: cloudShareError.context.requestHeaders }
        : {}),
      ...(cloudShareError?.context?.requestBody !== undefined
        ? { body: normalizeDiagnosticPayload(cloudShareError.context.requestBody) }
        : {}),
    },
    response: {
      ...(diagnostic.responseStatus !== undefined ? { status: diagnostic.responseStatus } : {}),
      ...(cloudShareError?.context?.responseHeaders
        ? { headers: cloudShareError.context.responseHeaders }
        : {}),
      ...(cloudShareError?.context?.responseBody !== undefined
        ? { body: normalizeDiagnosticPayload(cloudShareError.context.responseBody) }
        : {}),
    },
    details: {
      integrationSurface: spec.integrationSurface,
      failureMode: diagnostic.failureMode,
    },
    externalIds: { resourceType: spec.resourceType, ...(spec.resourceIds ?? {}) },
  };
}

async function safeRecordDiagnostic(
  deps: Pick<SyncHandlerDeps, "diagnostics" | "logger">,
  entry: DiagnosticLogEntryInput,
): Promise<void> {
  if (!deps.diagnostics) {
    return;
  }

  try {
    await deps.diagnostics.record(entry);
  } catch (error) {
    deps.logger.warn("admin diagnostic recording failed", {
      operation: entry.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function asCloudShareErrorLike(error: unknown): CloudShareError | null {
  if (
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError ||
    error instanceof CloudShareError
  ) {
    return error;
  }
  return null;
}

function buildCloudShareFailureDiagnostic(
  error: CloudShareError,
): {
  readonly method: string;
  readonly failureMode: string;
  readonly responseStatus?: number;
} {
  const errorName = error.name;
  const diagnostic = {
    method: (error.context?.method as string | undefined) ?? "GET",
    failureMode: "cloudshare_error",
    responseStatus: undefined as number | undefined,
  };

  if (error instanceof CloudShareRequestError || errorName === "CloudShareRequestError") {
    diagnostic.failureMode = "http_status";
    diagnostic.responseStatus =
      error instanceof CloudShareRequestError
        ? error.status
        : (error.context?.status as number | undefined);
  } else if (error instanceof CloudShareTransportError || errorName === "CloudShareTransportError") {
    diagnostic.failureMode = "transport";
  } else if (error instanceof CloudShareResponseError || errorName === "CloudShareResponseError") {
    diagnostic.failureMode = "unexpected_response";
  }

  return diagnostic;
}

function normalizeDiagnosticPayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// --- Event log ---

export interface EventLogHandlerDeps {
  readonly eventLog: EventLogRepository;
  readonly logger: Logger;
}

export interface AdminEventLogServices {
  readonly eventLog: EventLogRepository;
  readonly logger: Logger;
}

export function buildAdminEventLogDeps(
  services: AdminEventLogServices,
): EventLogHandlerDeps {
  return {
    eventLog: services.eventLog,
    logger: services.logger,
  };
}

export async function handleGetEventLog(
  deps: EventLogHandlerDeps,
  request: AdminRequest & { customerId: string },
): Promise<AdminResponse> {
  const limitParam = request.query.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const events = await deps.eventLog.listByCustomerId(
    request.customerId,
    limit !== undefined && !isNaN(limit) ? limit : undefined,
  );
  return { status: 200, body: { events } };
}

// --- Diagnostic log (typed support source of truth, ADR-004) ---

export interface DiagnosticLogHandlerDeps {
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

export interface AdminDiagnosticLogServices {
  readonly diagnostics: DiagnosticLogRepository;
  readonly logger: Logger;
}

export function buildAdminDiagnosticLogDeps(
  services: AdminDiagnosticLogServices,
): DiagnosticLogHandlerDeps {
  return {
    diagnostics: services.diagnostics,
    logger: services.logger,
  };
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
  const examId = request.query.examId?.trim();
  const examAttemptId = request.query.examAttemptId?.trim();
  const candidateEmail = request.query.candidateEmail?.trim().toLowerCase();
  const operation = request.query.operation?.trim();
  const outcome = parseDiagnosticOutcome(request.query.outcome);
  const source = request.query.source?.trim();
  const correlationId = request.query.correlationId?.trim();
  const subjectId = request.query.subjectId?.trim();
  const integrationSurface = request.query.integrationSurface?.trim();
  const externalId = request.query.externalId?.trim();
  const limitParam = request.query.limit;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  const offsetParam = request.query.offset;
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined;

  const boundedLimit =
    limit !== undefined && !Number.isNaN(limit)
      ? Math.min(Math.max(Math.floor(limit), 1), MAX_DIAGNOSTIC_QUERY_LIMIT)
      : undefined;

  const query = {
    customerId: request.customerId,
    ...(examId ? { examId } : {}),
    ...(examAttemptId ? { examAttemptId } : {}),
    ...(candidateEmail ? { candidateEmail } : {}),
    ...(operation ? { operation } : {}),
    ...(outcome ? { outcome } : {}),
    ...(source ? { source } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(integrationSurface ? { integrationSurface } : {}),
    ...(externalId ? { externalId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(offset !== undefined && !Number.isNaN(offset) ? { offset } : {}),
  } as const;

  const pageLimit = boundedLimit ?? 100;
  const pageOffset =
    offset !== undefined && !Number.isNaN(offset) && Number.isFinite(offset) && offset > 0
      ? Math.floor(offset)
      : 0;
  const entries = await deps.diagnostics.query({
    ...query,
    limit: pageLimit,
  });
  const pageEntries = entries;
  const hasMore =
    pageEntries.length === pageLimit &&
    (
      await deps.diagnostics.query({
        ...query,
        limit: 1,
        offset: pageOffset + pageEntries.length,
      })
    ).length > 0;

  return {
    status: 200,
    body: {
      entries: pageEntries.map(serialiseDiagnosticEntry),
      page: {
        limit: pageLimit,
        offset: pageOffset,
        returned: pageEntries.length,
        hasMore,
        nextOffset: hasMore ? pageOffset + pageEntries.length : null,
      },
    },
  };
}

function parseDiagnosticOutcome(value: string | undefined): DiagnosticOutcome | undefined {
  if (value === "success" || value === "failure") {
    return value;
  }
  return undefined;
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
