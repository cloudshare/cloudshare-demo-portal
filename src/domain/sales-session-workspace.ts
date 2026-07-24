import { isProjectableSalesParticipantRosterEnvironment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "./sales-participant-environment";
import type { SalesParticipantEnvironmentObservation } from "./sales-participant-environment";

export interface SalesSessionWorkspaceResponse {
  readonly summary: { readonly id: string; readonly sessionName: string; readonly revision: number; readonly start: string; readonly end: string; readonly timeZone: string; readonly operation: { readonly value: string; readonly source: string }; readonly experience: { readonly value: string; readonly source: string; readonly freshness: string; readonly observedAt?: string } };
  readonly participants: readonly { readonly id: string; readonly name: string; readonly email: string; readonly invitationStatus: "sent" | "notSent"; readonly participationStatus: string; readonly environment: SalesParticipantEnvironmentObservation }[];
  readonly activity: readonly SafeSalesSessionActivity[];
  readonly details: { readonly accountName: string; readonly opportunityName: string; readonly itemName: string; readonly invitationMode: string };
}
export type SalesSessionWorkspaceRead = { readonly state: "available"; readonly workspace: SalesSessionWorkspaceResponse } | { readonly state: "stale" };

export type SafeSalesSessionActivity = {
  readonly occurredAt: string;
  readonly summary: string;
  readonly outcome: "success" | "failure";
  readonly actor: { readonly type: "admin" | "candidate" | "system" | "unknown" } | null;
  readonly subject: { readonly type: "sales_demo_session"; readonly id: string };
  readonly correlationId?: string;
};

/** Ordinary Session Activity is deliberately a fresh DTO, not a trimmed
 * DiagnosticLogEntry. Unknown operations and actor types fail closed to generic
 * safe copy; raw diagnostic messages and evidence never cross this seam. */
export function projectSafeSalesSessionActivity(input: { readonly occurredAt: Date; readonly operation: string; readonly outcome: string; readonly actorType: string | null; readonly subjectType: string | null; readonly subjectId: string | null; readonly correlationId: string | null }, sessionId: string): SafeSalesSessionActivity | null {
  if (input.subjectType !== "sales_demo_session" || input.subjectId !== sessionId || (input.outcome !== "success" && input.outcome !== "failure")) return null;
  return { occurredAt: input.occurredAt.toISOString(), summary: activitySummary(input.operation, input.outcome), outcome: input.outcome === "failure" ? "failure" : "success", actor: input.actorType ? { type: safeActorType(input.actorType) } : null, subject: { type: "sales_demo_session", id: sessionId }, ...(input.correlationId ? { correlationId: input.correlationId } : {}) };
}

function activitySummary(operation: string, outcome: string): string {
  const action = operation === "sales.demo_session.created" ? "Sales Session provision"
    : operation.startsWith("sales.demo_session.participants.") ? "Sales Participant operation"
      : operation === "sales.demo_session.reconciled" ? "Sales Session reconciliation"
        : "Sales Session operation";
  return `${action} ${outcome === "failure" ? "failed" : "completed"}.`;
}
function safeActorType(value: string): "admin" | "candidate" | "system" | "unknown" { return value === "admin" || value === "candidate" || value === "system" ? value : "unknown"; }

export function projectSafeSalesParticipantEnvironment(input: { readonly cloudShareRosterEnvironmentReference: string | null; readonly environmentStatus: string | null; readonly environmentStatusCode: number | null; readonly environmentObservedAt: Date | null }) {
  return input.environmentStatus && input.environmentObservedAt && isProjectableSalesParticipantRosterEnvironment(input.environmentStatus)
    ? projectSalesParticipantRosterEnvironment(input.environmentStatus, input.environmentObservedAt)
    : input.cloudShareRosterEnvironmentReference ? { dimension: "cloudshare_environment" as const, value: null, source: "not_observed" as const }
      : projectSalesParticipantEnvironment(input.environmentStatusCode, input.environmentObservedAt ?? undefined);
}
