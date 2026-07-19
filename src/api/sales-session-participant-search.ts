import { z } from "zod";

export type SalesParticipantSearchRow = { readonly id: string; readonly sessionId: string; readonly sessionName: string; readonly opportunityId: string; readonly firstName: string; readonly lastName: string; readonly email: string; readonly environment: { readonly dimension: "cloudshare_environment"; readonly value: null; readonly source: "not_observed" | "not_assigned" } };
export interface SalesParticipantSearchRepository { search(customerId: string, term: string, offset: number, limit: number): Promise<{ readonly rows: readonly SalesParticipantSearchRow[]; readonly total: number }>; }
const querySchema = z.object({ term: z.string().trim().min(2).max(100), offset: z.coerce.number().int().min(0).max(10_000).default(0), limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Customer-scoped local read only: no CloudShare calls and no provider IDs in its browser model. */
export async function handleSearchSalesSessionParticipants(deps: { readonly search: SalesParticipantSearchRepository }, request: { readonly customerId: string; readonly term?: string | null; readonly offset?: string | null; readonly limit?: string | null }) {
  const parsed = querySchema.safeParse({ term: request.term, offset: request.offset ?? undefined, limit: request.limit ?? undefined });
  if (!parsed.success) return { status: 400, body: { error: "Participant search requires 2–100 characters and a bounded page." } };
  const page = await deps.search.search(request.customerId, parsed.data.term, parsed.data.offset, parsed.data.limit);
  return { status: 200, body: { participants: page.rows, total: page.total, offset: parsed.data.offset, limit: parsed.data.limit } };
}
