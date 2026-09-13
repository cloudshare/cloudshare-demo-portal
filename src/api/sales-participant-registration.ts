import type { DiagnosticActor } from "@/domain/diagnostic-log";
import type { SalesParticipantWorkspace } from "@/domain/sales-participant-workspace";
export async function handleRegisterSalesParticipantWorkspace(deps: { workspace: SalesParticipantWorkspace }, input: { customerId: string; sessionId: string; actor: DiagnosticActor; body: unknown }) {
  const ids = input.body && typeof input.body === "object" && Array.isArray((input.body as { opportunityContactIds?: unknown }).opportunityContactIds) ? (input.body as { opportunityContactIds: unknown[] }).opportunityContactIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : null;
  if (!ids?.length || ids.length > 100) return { status: 400, body: { error: "Select one or more Opportunity Contacts." } };
  return deps.workspace.registerParticipants({ customerId: input.customerId, sessionId: input.sessionId, actor: input.actor, opportunityContactIds: ids });
}
