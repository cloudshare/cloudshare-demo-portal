import type { DiagnosticActor } from "@/domain/diagnostic-log";
import type { SalesParticipantWorkspace, SalesParticipantWorkspaceAddParticipantInput } from "@/domain/sales-participant-workspace";
export async function handleAddSalesParticipantWorkspace(deps: { workspace: SalesParticipantWorkspace }, input: { customerId: string; sessionId: string; actor: DiagnosticActor; body: unknown }) {
  if (!deps.workspace.addParticipant) return { status: 501, body: { error: "Participant add is unavailable." } };
  const body = input.body && typeof input.body === "object" ? input.body as Record<string, unknown> : {};
  const commandId = typeof body.commandId === "string" ? body.commandId.trim() : "";
  const person = body.person;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId) || !person || typeof person !== "object") return { status: 400, body: { error: "Provide a valid commandId and participant details." } };
  const value = person as Record<string, unknown>;
  let normalized: SalesParticipantWorkspaceAddParticipantInput["person"];
  if (value.kind === "existingContact" && typeof value.contactId === "string" && value.contactId.trim()) normalized = { kind: "existingContact", contactId: value.contactId.trim() };
  else if (value.kind === "adHoc" && typeof value.firstName === "string" && typeof value.lastName === "string" && typeof value.email === "string" && value.firstName.trim().length <= 100 && value.lastName.trim().length <= 100 && value.email.trim().length <= 320 && value.firstName.trim() && value.lastName.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.email.trim())) normalized = { kind: "adHoc", firstName: value.firstName.trim(), lastName: value.lastName.trim(), email: value.email.trim() };
  else return { status: 400, body: { error: "Provide an existing Contact or a valid new person." } };
  return deps.workspace.addParticipant({ customerId: input.customerId, sessionId: input.sessionId, actor: input.actor, commandId, person: normalized });
}
