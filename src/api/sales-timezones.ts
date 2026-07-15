import type { CloudShareConnectionRepository, CloudShareClientFactory } from "@/domain/cloudshare-connection";
import { isSalesExperienceType, isSalesTimezoneCacheFresh, type SalesAdminPreferenceRepository, type SalesTimezoneCacheRepository } from "@/domain/sales-timezones";
import { createCloudShareTimezoneSource, type CloudShareTimezoneSource } from "@/integrations/cloudshare/timezones";

export interface SalesTimezonesDeps {
  readonly cache: SalesTimezoneCacheRepository;
  readonly preferences: SalesAdminPreferenceRepository;
  readonly connections: Pick<CloudShareConnectionRepository, "findByCustomerId">;
  readonly timezoneSourceFactory?: { forConnection(connection: NonNullable<Awaited<ReturnType<CloudShareConnectionRepository["findByCustomerId"]>>>): CloudShareTimezoneSource };
  readonly cloudshare?: Pick<CloudShareClientFactory, "forConnection">;
  readonly now?: () => Date;
}

export async function handleGetSalesTimezones(deps: SalesTimezonesDeps, request: { customerId: string; userId: string }) {
  const now = (deps.now ?? (() => new Date()))();
  const [cached, preference] = await Promise.all([deps.cache.find(request.customerId), deps.preferences.find(request.userId)]);
  if (cached && isSalesTimezoneCacheFresh(cached, now)) return { status: 200, body: { timezones: cached.timezones, fetchedAt: cached.fetchedAt.toISOString(), freshness: "fresh", preference } };
  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) return cached ? { status: 200, body: { timezones: cached.timezones, fetchedAt: cached.fetchedAt.toISOString(), freshness: "stale", preference, warning: "CloudShare Connection is unavailable; showing the last verified timezone catalogue." } } : { status: 404, body: { error: "Save a CloudShare Connection before retrieving timezones." } };
  try {
    const source = deps.timezoneSourceFactory?.forConnection(connection) ?? createCloudShareTimezoneSource((deps.cloudshare ?? missingClientFactory).forConnection(connection));
    const live = await source.list();
    await deps.cache.save({ customerId: request.customerId, timezones: live.timezones, fetchedAt: now });
    return { status: 200, body: { timezones: live.timezones, fetchedAt: now.toISOString(), freshness: "live", preference } };
  } catch {
    return cached ? { status: 200, body: { timezones: cached.timezones, fetchedAt: cached.fetchedAt.toISOString(), freshness: "stale", preference, warning: "CloudShare could not refresh timezones; showing the last verified catalogue." } } : { status: 502, body: { error: "CloudShare could not retrieve supported timezones." } };
  }
}

export async function handleSaveSalesPreference(deps: SalesTimezonesDeps, request: { userId: string; body: unknown }) {
  const body = typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : null;
  const timeZone = typeof body?.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : null;
  const experienceType = body?.experienceType;
  if (!timeZone || !isSalesExperienceType(experienceType)) return { status: 400, body: { error: "timeZone and a valid Sales Experience type are required." } };
  await deps.preferences.save(request.userId, { timeZone, experienceType });
  return { status: 204, body: {} };
}

const missingClientFactory: Pick<CloudShareClientFactory, "forConnection"> = { forConnection() { throw new Error("CloudShare timezone source is not configured."); } };
