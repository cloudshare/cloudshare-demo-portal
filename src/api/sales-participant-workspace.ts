import type { SalesParticipantWorkspaceReader } from "@/domain/sales-participant-workspace";
import { validateParticipantPage } from "@/domain/sales-participant-workspace";
export async function handleReadSalesParticipantWorkspacePage(deps: { reader: SalesParticipantWorkspaceReader }, input: { customerId: string; sessionId: string; query?: string; offset?: number; limit?: number; now?: Date }) {
  const page = validateParticipantPage(input); if (!page) return { status: 400 as const, body: { error: "Invalid participant page." } };
  const result = await deps.reader.readPage({ ...page, customerId: input.customerId, sessionId: input.sessionId, now: input.now ?? new Date() });
  return result ? { status: 200 as const, body: result } : { status: 404 as const, body: { error: "This Sales Session is unavailable for this Customer." } };
}
