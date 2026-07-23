import { z } from "zod";
import { belongsInSalesSessionQueue, classifySalesSessionQueueRow, parseSalesSessionQueueSort, parseSalesSessionQueueView } from "@/domain/sales-session-queue";
import type { SalesSessionQueueRepository } from "@/persistence/prisma-sales-session-queue-repository";

const querySchema = z.object({ view: z.string().optional(), accountId: z.string().trim().min(1).max(100).optional(), opportunityId: z.string().trim().min(1).max(100).optional(), search: z.string().trim().max(120).optional(), sort: z.string().optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(50).default(25), target: z.string().trim().min(1).max(100).optional() });
export interface SalesSessionQueueHandlerDeps { readonly queue: SalesSessionQueueRepository; readonly now?: () => Date; }
export interface SalesSessionQueueHandlerRequest { readonly customerId: string; readonly query: Record<string, string | null>; }

export async function handleReadSalesSessionQueue(deps: SalesSessionQueueHandlerDeps, request: SalesSessionQueueHandlerRequest) {
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) return { status: 400, body: { error: "Invalid Sales Sessions queue query." } };
  const view = parseSalesSessionQueueView(parsed.data.view);
  const now = (deps.now ?? (() => new Date()))();
  const page = await deps.queue.read({ customerId: request.customerId, view, accountId: parsed.data.accountId, opportunityId: parsed.data.opportunityId, search: parsed.data.search, sort: parseSalesSessionQueueSort(parsed.data.sort), offset: parsed.data.offset, limit: parsed.data.limit, now });
  const rows = page.rows.map((session) => classifySalesSessionQueueRow(session, now));
  const target = parsed.data.target ? await restoreTarget(deps.queue, request.customerId, parsed.data.target, rows) : undefined;
  return { status: 200, body: { view, offset: parsed.data.offset, limit: parsed.data.limit, total: page.total, rows, ...(target ? { target } : {}) } };
}

async function restoreTarget(queue: SalesSessionQueueRepository, customerId: string, targetId: string, rows: readonly { readonly id: string }[]) {
  if (rows.some((row) => row.id === targetId)) return { id: targetId, state: "available" as const };
  const target = await queue.findTarget(customerId, targetId);
  if (!target) return { id: targetId, state: "missing" as const, message: "The requested Session is no longer available for this Customer." };
  if (target.archived) return { id: targetId, state: "archived" as const, message: "The requested Session belongs to archived sales records and cannot be restored here." };
  return { id: targetId, state: "outside_current_queue" as const, message: "The requested Session is outside the current queue filters." };
}
