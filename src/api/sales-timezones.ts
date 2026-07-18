import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { randomUUID } from "node:crypto";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticActor, DiagnosticRecorder } from "@/domain/diagnostic-log";
import { isSalesExperienceType, isSalesTimezoneCacheFresh, type SalesAdminPreferenceRepository, type SalesTimezoneCacheRepository } from "@/domain/sales-timezones";
import { createCloudShareTimezoneSource, type CloudShareTimezoneSource } from "@/integrations/cloudshare/timezones";

export interface SalesTimezonesDeps {
  readonly cache: SalesTimezoneCacheRepository;
  readonly preferences: SalesAdminPreferenceRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly timezoneSourceFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): CloudShareTimezoneSource };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly now?: () => Date;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: Pick<AuditRepository, "write">;
}

export async function handleGetSalesTimezones(deps: SalesTimezonesDeps, request: { customerId: string; userId: string; actor?: DiagnosticActor }) {
  const now = (deps.now ?? (() => new Date()))();
  const [cached, preference] = await Promise.all([deps.cache.find(request.customerId), deps.preferences.find(request.userId)]);
  if (cached && isSalesTimezoneCacheFresh(cached, now)) return { status: 200, body: { timezones: cached.timezones, fetchedAt: cached.fetchedAt.toISOString(), freshness: "fresh", preference } };
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) return cached ? { status: 200, body: { timezones: cached.timezones, fetchedAt: cached.fetchedAt.toISOString(), freshness: "stale", preference, warning: "CloudShare Connection is unavailable; showing the last verified timezone catalogue." } } : { status: 404, body: { error: "Save a CloudShare Connection before retrieving timezones." } };
  try {
    const source = deps.timezoneSourceFactory?.forConnection(connection) ?? createCloudShareTimezoneSource((deps.cloudshare ?? missingClientFactory).forConnection(connection));
    const live = await source.list();
    await deps.cache.save({ customerId: request.customerId, timezones: live.timezones, fetchedAt: now });
    const correlationId = randomUUID();
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-timezones", operation: "sales.timezones.refreshed", outcome: "success", level: "info", customerId: request.customerId, actor: request.actor, message: "CloudShare timezone catalogue refreshed", correlationId, request: live.request as Record<string, unknown>, response: live.response as Record<string, unknown>, details: { integrationSurface: "cloudshare.v3.timezones", timezoneCount: live.timezones.length } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor?.type, actorId: request.actor?.id, actorEmail: request.actor?.email, action: "sales.timezones.refreshed", subjectType: "sales_timezone_cache", subjectId: request.customerId, outcome: "success", correlationId, details: { integrationSurface: "cloudshare.v3.timezones", timezoneCount: live.timezones.length } }),
    ]);
    return { status: 200, body: { timezones: live.timezones, fetchedAt: now.toISOString(), freshness: "live", preference } };
  } catch (error) {
    const correlationId = randomUUID();
    const exchange = cloudShareExchange(error);
    await Promise.allSettled([
      deps.diagnostics?.record({ source: "sales-timezones", operation: "sales.timezones.refreshed", outcome: "failure", level: "warn", customerId: request.customerId, actor: request.actor, message: "CloudShare timezone catalogue refresh failed", correlationId, request: exchange?.request, response: exchange?.response, details: { integrationSurface: "cloudshare.v3.timezones", failureMode: "timezone_catalogue_read", error: error instanceof Error ? error.message : String(error) } }),
      deps.audit?.write({ id: randomUUID(), occurredAt: now, customerId: request.customerId, actorType: request.actor?.type, actorId: request.actor?.id, actorEmail: request.actor?.email, action: "sales.timezones.refreshed", subjectType: "sales_timezone_cache", subjectId: request.customerId, outcome: "failure", correlationId, details: { integrationSurface: "cloudshare.v3.timezones", failureMode: "timezone_catalogue_read" }, error: error instanceof Error ? error.message : String(error) }),
    ]);
    return cached ? { status: 200, body: { timezones: cached.timezones, fetchedAt: cached.fetchedAt.toISOString(), freshness: "stale", preference, correlationId, warning: "CloudShare could not refresh timezones; showing the last verified catalogue." } } : { status: 502, body: { error: "CloudShare could not retrieve supported timezones.", correlationId } };
  }
}

function cloudShareExchange(error: unknown): { request?: Record<string, unknown>; response?: Record<string, unknown> } | undefined {
  if (!(error instanceof Error) || !("context" in error)) return undefined;
  const context = (error as { context?: Record<string, unknown> }).context;
  return context ? { request: { method: context.method, path: context.path, headers: context.requestHeaders, query: context.requestQuery }, response: { status: context.responseStatus ?? context.status, headers: context.responseHeaders, body: context.responseBody, transport: context.cause } } : undefined;
}

export async function handleSaveSalesPreference(deps: SalesTimezonesDeps, request: { customerId: string; userId: string; body: unknown }) {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : null;
  const timeZone = typeof body?.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : null;
  const experienceType = body?.experienceType;
  if (!timeZone || !isSalesExperienceType(experienceType)) return { status: 400, body: { error: "timeZone and a valid Sales Experience type are required." } };
  const cached = await deps.cache.find(request.customerId);
  if (!cached || !cached.timezones.some((zone) => zone.id === timeZone)) return { status: 422, body: { error: "Select a timezone from the documented CloudShare catalogue." } };
  await deps.preferences.save(request.userId, { timeZone, experienceType });
  return { status: 204, body: {} };
}

const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = { forConnection() { throw new Error("CloudShare timezone source is not configured."); } };
