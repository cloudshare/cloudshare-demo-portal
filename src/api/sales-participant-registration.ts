import type { DiagnosticActor } from "@/domain/diagnostic-log";
import type { SalesParticipantWorkspace } from "@/domain/sales-participant-workspace";
export async function handleRegisterSalesParticipantWorkspace(deps: { workspace: SalesParticipantWorkspace }, input: { customerId: string; sessionId: string; actor: DiagnosticActor; body: unknown }) {
  const raw = input.body && typeof input.body === "object" && Array.isArray((input.body as { opportunityContactIds?: unknown }).opportunityContactIds) ? (input.body as { opportunityContactIds: unknown[] }).opportunityContactIds : null;
  const ids = raw?.every((id): id is string => typeof id === "string") ? raw.map((id) => id.trim()) : null;
  if (!ids?.length || ids.some((id) => !id) || ids.length > 100 || new Set(ids).size !== ids.length) return { status: 400, body: { error: "Select one or more unique Opportunity Contacts." } };
  return deps.workspace.registerParticipants({ customerId: input.customerId, sessionId: input.sessionId, actor: input.actor, opportunityContactIds: ids });
}
