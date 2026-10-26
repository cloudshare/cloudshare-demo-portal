import { z } from "zod";
import type { CloudShareClient, CloudShareDetailedResult, V4RequestSpec } from "./client";
import { CloudShareResponseError } from "./errors";

// Wire values stay inside this module; protected exchanges retain the full body.
const utcDate = z.string().regex(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/).refine(value => Number.isFinite(Date.parse(value)), "Invalid UTC date");
export const v4EnvironmentSchema = z.object({ id: z.string().min(1), projectId: z.string().min(1), ownerEmail: z.string().nullable(), status: z.string().min(1), startTime: utcDate, expirationTime: utcDate });
export type V4Environment = z.infer<typeof v4EnvironmentSchema>;
const pageSchema = z.object({ count: z.number().int().nonnegative(), items: z.array(v4EnvironmentSchema) });
export async function readV4Environment(client: CloudShareClient, id: string) {
  const result = await read(client, { method: "GET", path: `/environments/${encodeURIComponent(id)}`, schema: v4EnvironmentSchema });
  if (result.data.id !== id) throw invalid(result, "Environment identity changed");
  return result;
}
export async function listV4Environments(client: CloudShareClient, ownerEmail: string) {
  const reads: CloudShareDetailedResult<unknown>[] = [];
  const items: V4Environment[] = [];
  let total: number | undefined;
  try {
  do {
    const result = await read(client, { method: "GET", path: "/environments", query: { OwnerEmail: ownerEmail.trim().toLowerCase(), Count: "true", Offset: String(items.length), Limit: "100" }, schema: pageSchema });
    if ((total !== undefined && result.data.count !== total) || (result.data.items.length === 0 && items.length < result.data.count) || items.length + result.data.items.length > result.data.count || result.data.items.some(item => items.some(previous => previous.id === item.id)) || new Set(result.data.items.map(item => item.id)).size !== result.data.items.length) throw invalid(result, "Incomplete or inconsistent Environment page");
    total = result.data.count;
    reads.push(result);
    items.push(...result.data.items);
  } while (items.length < total);
  return { items, reads };
  } catch (error) { throw withEnvironmentExchanges(error, reads); }
}
async function read<T>(client: CloudShareClient, spec: V4RequestSpec<T>): Promise<CloudShareDetailedResult<T>> {
  if (client.requestV4Detailed) return client.requestV4Detailed(spec);
  const data = await client.requestV4(spec);
  return { data, request: { method: spec.method, path: `/v4${spec.path}`, ...(spec.query ? { query: spec.query } : {}) }, response: { status: 200, body: data }, host: "", integrationSurface: "cloudshare.v4.environments" };
}
export function invalid(result: CloudShareDetailedResult<unknown>, message: string) {
  return new CloudShareResponseError(message, { method: result.request.method, path: result.request.path, requestQuery: result.request.query, requestHeaders: result.request.headers, responseStatus: result.response.status, status: result.response.status, responseBody: result.response.body, responseHeaders: result.response.headers, integrationSurface: "cloudshare.v4.environments" });
}

/** Retain completed pages on the original typed error (404/429 semantics stay intact). */
export function withEnvironmentExchanges(error: unknown, reads: readonly { request: unknown; response: unknown }[]) {
  if (error && typeof error === "object") {
    Object.assign(error, { exchanges: reads.map(({ request, response }) => ({ request, response })) });
    const context = (error as { context?: Record<string, unknown> }).context;
    if (context) context.httpExchanges = reads.map(({ request, response }) => ({ request, response }));
  }
  return error;
}

export function completedEnvironmentExchanges(error: unknown): readonly { request: unknown; response: unknown }[] {
  const exchanges = error && typeof error === "object" && "exchanges" in error ? error.exchanges : undefined;
  return Array.isArray(exchanges) ? exchanges : [];
}
