import type { DiagnosticActor } from "@/domain/diagnostic-log";
import type { SalesParticipantWorkspace, SalesParticipantWorkspaceAddParticipantInput } from "@/domain/sales-participant-workspace";
export async function handleAddSalesParticipantWorkspace(deps: { workspace: SalesParticipantWorkspace }, input: { customerId: string; sessionId: string; actor: DiagnosticActor; body: unknown }) {
  if (!deps.workspace.addParticipant) return { status: 501, body: { error: "Participant add is unavailable." } };
  const body = input.body && typeof input.body === "object" ? input.body as Record<string, unknown> : {};
  const commandId = typeof body.commandId === "string" ? body.commandId.trim() : "";
  const person = body.person;
  if (!commandId || !person || typeof person !== "object") return { status: 400, body: { error: "Provide a commandId and participant details." } };
  const value = person as Record<string, unknown>;
  let normalized: SalesParticipantWorkspaceAddParticipantInput["person"];
  if (value.kind === "existingContact" && typeof value.contactId === "string" && value.contactId.trim()) normalized = { kind: "existingContact", contactId: value.contactId.trim() };
  else if (value.kind === "adHoc" && typeof value.firstName === "string" && typeof value.lastName === "string" && typeof value.email === "string" && value.firstName.trim() && value.lastName.trim() && value.email.trim()) normalized = { kind: "adHoc", firstName: value.firstName.trim(), lastName: value.lastName.trim(), email: value.email.trim() };
  else return { status: 400, body: { error: "Provide an existing Contact or a valid new person." } };
  return deps.workspace.addParticipant({ customerId: input.customerId, sessionId: input.sessionId, actor: input.actor, commandId, person: normalized });
}
export async function handleRegisterSalesParticipantWorkspace(deps: { workspace: SalesParticipantWorkspace }, input: { customerId: string; sessionId: string; actor: DiagnosticActor; body: unknown }) {
  const raw = input.body && typeof input.body === "object" && Array.isArray((input.body as { opportunityContactIds?: unknown }).opportunityContactIds) ? (input.body as { opportunityContactIds: unknown[] }).opportunityContactIds : null;
  const ids = raw?.every((id): id is string => typeof id === "string") ? raw.map((id) => id.trim()) : null;
  if (!ids?.length || ids.some((id) => !id) || ids.length > 100 || new Set(ids).size !== ids.length) return { status: 400, body: { error: "Select one or more unique Opportunity Contacts." } };
  return deps.workspace.registerParticipants({ customerId: input.customerId, sessionId: input.sessionId, actor: input.actor, opportunityContactIds: ids });
}
