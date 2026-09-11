import { isProjectableSalesParticipantRosterEnvironment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment } from "./sales-participant-environment";
import type { SalesParticipantEnvironmentObservation } from "./sales-participant-environment";
import type { projectSalesSessionStatus } from "./sales-session-status";

export interface SalesSessionWorkspaceResponse {
  readonly summary: { readonly id: string; readonly sessionName: string; readonly revision: number; readonly start: string; readonly end: string; readonly timeZone: string; readonly operation: ReturnType<typeof projectSalesSessionStatus>["operation"]; readonly experience: { readonly value: string; readonly source: string; readonly freshness: string; readonly observedAt?: string } };
  readonly participants: readonly { readonly id: string; readonly name: string; readonly email: string; readonly invitationStatus: "sent" | "notSent"; readonly participationStatus: string; readonly environment: SalesParticipantEnvironmentObservation; readonly environmentAttention: SafeSalesParticipantAttention | null }[];
  readonly activity: readonly SafeSalesSessionActivity[];
  readonly activityGroups: readonly SafeSalesSessionActivityGroup[];
  readonly activityHistory: { readonly complete: boolean; readonly hasMore: boolean; readonly reason?: "source_scan_limit" | "workflow_presentation_limit"; readonly presentedWorkflowCount?: number; readonly totalWorkflowCount?: number };
  readonly details: { readonly accountName: string; readonly opportunityName: string; readonly itemName: string; readonly invitationMode: string };
}
export type SalesSessionWorkspaceRead = { readonly state: "available"; readonly workspace: SalesSessionWorkspaceResponse } | { readonly state: "stale" };
export type SafeSalesParticipantAttention = { readonly reason: string; readonly source: string };

export type SafeSalesSessionActivity = {
  /** Persisted diagnostic identity used only to keep uncorrelated rows stable. */
  readonly activityId?: string;
  readonly occurredAt: string;
  readonly kind: "session_provision" | "session_reconciliation" | "participants_registered" | "participants_invited" | "participants_reconciled" | "participant_environment_observed" | "participant_reconciled" | "participant_properties_ensured" | "participant_correlation_backfilled" | "unknown";
  readonly summary: string;
  readonly outcome: "success" | "failure" | "incomplete";
  readonly actor: { readonly type: "admin" | "candidate" | "system" | "unknown" } | null;
  readonly subject: { readonly type: "sales_demo_session"; readonly id: string };
  readonly correlationId?: string;
};
export type SafeSalesSessionActivityStep = { readonly label: string; readonly outcome: "success" | "failure" | "incomplete"; readonly occurredAt: string };
export type SafeSalesSessionActivityGroup = { readonly workflowId: string; readonly summary: string; readonly outcome: "success" | "failure" | "mixed" | "incomplete"; readonly actor: string; readonly subject: string; readonly firstAt: string; readonly lastAt: string; readonly count: number; readonly correlationId?: string; readonly steps: readonly SafeSalesSessionActivityStep[]; readonly diagnosticRecords: readonly { readonly correlationId: string; readonly occurredAt: string }[] };

/** Groups complete workflow anchors in the read model, not in the browser. */
export function groupSafeSalesSessionActivity(entries: readonly SafeSalesSessionActivity[]): readonly SafeSalesSessionActivityGroup[] {
  const groups = new Map<string, { entries: SafeSalesSessionActivity[]; group: SafeSalesSessionActivityGroup }>();
  const knownByCorrelation = new Map<string, Set<string>>();
  const terminalKinds = new Set(["session_provision", "session_reconciliation", "participants_registered", "participants_invited", "participants_reconciled"]);
  for (const entry of entries) if (entry.correlationId && terminalKinds.has(entry.kind)) {
    const kinds = knownByCorrelation.get(entry.correlationId) ?? new Set<string>(); kinds.add(entry.kind); knownByCorrelation.set(entry.correlationId, kinds);
  }
  const orderedEntries = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || (a.activityId ?? "").localeCompare(b.activityId ?? "") || a.kind.localeCompare(b.kind));
  for (const [index, entry] of orderedEntries.entries()) {
    const actor = safeActivityActor(entry.actor?.type);
    const known = entry.correlationId ? knownByCorrelation.get(entry.correlationId) : undefined;
    // Transport/OAuth/revalidation rows are intentionally absorbed into the
    // single known business workflow for that correlation (#431). If the
    // correlation has multiple business meanings, unknown evidence remains a
    // controlled incomplete child rather than being assigned ambiguously.
    const businessKind = (!terminalKinds.has(entry.kind) && known?.size === 1) ? [...known][0] : entry.kind;
    // Correlation is the stable workflow anchor. Legacy rows have no anchor;
    // retain each persisted row independently, including same-millisecond rows.
    const correlationKind = known?.size === 1 ? [...known][0] : (!known || known.size === 0) ? "child_only" : businessKind;
    const key = `${entry.correlationId ? correlationKind : businessKind}\u0000${entry.correlationId ?? `legacy:${entry.occurredAt}:${entry.activityId ?? `index:${index}`}`}\u0000${entry.subject.type}`;
    const current = groups.get(key);
    const record = entry.correlationId ? [{ correlationId: entry.correlationId, occurredAt: entry.occurredAt }] : [];
    if (!current) { const incomplete = Boolean(entry.correlationId && !terminalKinds.has(entry.kind)); groups.set(key, { entries: [entry], group: { workflowId: key, summary: incomplete ? incompleteSummary() : entry.summary, outcome: incomplete ? "incomplete" : entry.outcome, actor, subject: "This Sales Session", firstAt: entry.occurredAt, lastAt: entry.occurredAt, count: 1, steps: [{ label: entry.summary, outcome: entry.outcome, occurredAt: entry.occurredAt }], ...(entry.correlationId ? { correlationId: entry.correlationId } : {}), diagnosticRecords: record } }); continue; }
    const nextEntries = [...current.entries, entry];
    const terminals = nextEntries.filter((candidate) => terminalKinds.has(candidate.kind));
    const terminal = terminals.find((candidate) => candidate.outcome === "failure") ?? terminals[terminals.length - 1];
    const hasFailure = nextEntries.some((candidate) => candidate.outcome === "failure");
    const hasSuccess = nextEntries.some((candidate) => candidate.outcome === "success");
    // The terminal business operation is authoritative for the workflow's
    // final status. Child transport/revalidation failures remain visible as
    // mixed evidence only when the terminal operation itself succeeded.
    const terminalOutcome = terminal?.outcome;
    // Child transport, OAuth, validation, and revalidation evidence never
    // establishes a business outcome by itself. Until a terminal business
    // row exists, the whole correlated history remains incomplete.
    const outcome = terminalOutcome === "failure" ? "failure" : terminalOutcome === "success" ? (hasFailure ? "mixed" : "success") : "incomplete";
    const authoritative = terminal ?? nextEntries[0];
    groups.set(key, { entries: nextEntries, group: { ...current.group, summary: terminal ? authoritative.summary : incompleteSummary(), actor: terminal ? safeActivityActor(authoritative.actor?.type) : current.group.actor, outcome, firstAt: nextEntries[0].occurredAt, lastAt: nextEntries[nextEntries.length - 1].occurredAt, count: nextEntries.length, steps: [...current.group.steps, { label: entry.summary, outcome: entry.outcome, occurredAt: entry.occurredAt }], diagnosticRecords: entry.correlationId && !current.group.diagnosticRecords.some((r) => r.correlationId === entry.correlationId) ? [...current.group.diagnosticRecords, ...record] : current.group.diagnosticRecords } });
  }
  return [...groups.values()].map(({ group }) => group).sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.firstAt.localeCompare(a.firstAt) || a.summary.localeCompare(b.summary));
}
function incompleteSummary(): string { return "Business outcome and evidence are incomplete."; }
function safeActivityActor(value: "admin" | "candidate" | "system" | "unknown" | undefined): string { return value === "admin" ? "Sales admin" : value === "candidate" ? "Candidate" : value === "system" ? "Certalis system" : value === "unknown" ? "Unknown actor" : "Not recorded"; }

/** Ordinary Session Activity is deliberately a fresh DTO, not a trimmed
 * DiagnosticLogEntry. Unknown operations and actor types fail closed to generic
 * safe copy; raw diagnostic messages and evidence never cross this seam. */
export function projectSafeSalesSessionActivity(input: { readonly id?: string; readonly occurredAt: Date; readonly operation: string; readonly outcome: string; readonly actorType: string | null; readonly subjectType: string | null; readonly subjectId: string | null; readonly correlationId: string | null; readonly detailsJson?: string | null }, sessionId: string): SafeSalesSessionActivity | null {
  if (input.subjectType !== "sales_demo_session" || input.subjectId !== sessionId || (input.outcome !== "success" && input.outcome !== "failure")) return null;
  const ambiguous = input.operation === "sales.demo_session.created.ambiguous";
  return { ...(input.id ? { activityId: input.id } : {}), occurredAt: input.occurredAt.toISOString(), kind: safeActivityKind(input.operation), summary: ambiguous ? incompleteSummary() : activitySummary(input.operation, input.outcome), outcome: ambiguous ? "incomplete" : input.outcome === "failure" ? "failure" : "success", actor: input.actorType ? { type: safeActorType(input.actorType) } : null, subject: { type: "sales_demo_session", id: sessionId }, ...(input.correlationId ? { correlationId: input.correlationId } : {}) };
}

function safeActivityKind(operation: string): SafeSalesSessionActivity["kind"] {
  if (operation === "sales.demo_session.created") return "session_provision";
  if (operation === "sales.demo_session.created.ambiguous") return "session_provision";
  if (operation === "sales.demo_session.reconciled") return "session_reconciliation";
  if (operation === "sales.demo_session.participants.registered") return "participants_registered";
  if (operation === "sales.demo_session.participants.invited") return "participants_invited";
  if (operation === "sales.demo_session.participants.reconciled") return "participants_reconciled";
  if (operation === "sales.demo_session.participant.environment_observed") return "participant_environment_observed";
  if (operation === "sales.demo_session.participant.reconciled") return "participant_reconciled";
  if (operation === "sales.demo_session.participant_properties.ensured") return "participant_properties_ensured";
  if (operation === "sales.demo_session.participant_correlation.backfilled") return "participant_correlation_backfilled";
  return "unknown";
}

function activitySummary(operation: string, outcome: string): string {
  if (operation === "sales.demo_session.participants.registered") return outcome === "failure" ? "Sales Participant registration failed." : "Sales Participants registered.";
  if (operation === "sales.demo_session.participants.invited") return outcome === "failure" ? "Sales Participant invitations failed." : "Sales Participant invitations sent.";
  if (operation === "sales.demo_session.participants.reconciled") return outcome === "failure" ? "Sales Participant reconciliation failed." : "Sales Participants reconciled.";
  if (operation === "sales.demo_session.participant.environment_observed") return outcome === "failure" ? "Participant Environment observation failed." : "Participant Environment observed.";
  if (operation === "sales.demo_session.participant.reconciled") return outcome === "failure" ? "Participant reconciliation failed." : "Participant reconciled.";
  if (operation === "sales.demo_session.participant_properties.ensured") return outcome === "failure" ? "Participant property confirmation failed." : "Participant properties confirmed.";
  if (operation === "sales.demo_session.participant_correlation.backfilled") return outcome === "failure" ? "Participant correlation backfill failed." : "Participant correlation backfilled.";
  const action = operation === "sales.demo_session.created" ? "Sales Session provision"
    : operation.startsWith("sales.demo_session.participants.") ? "Sales Participant operation"
      : operation === "sales.demo_session.reconciled" ? "Sales Session reconciliation"
        : "Sales Session update";
  return `${action} ${outcome === "failure" ? "failed" : "completed"}.`;
}
function safeActorType(value: string): "admin" | "candidate" | "system" | "unknown" { return value === "admin" || value === "candidate" || value === "system" ? value : "unknown"; }

export function projectSafeSalesParticipantEnvironment(input: { readonly cloudShareRosterEnvironmentReference: string | null; readonly environmentStatus: string | null; readonly environmentStatusCode: number | null; readonly environmentObservedAt: Date | null }) {
  return input.environmentStatus && input.environmentObservedAt && isProjectableSalesParticipantRosterEnvironment(input.environmentStatus)
    ? projectSalesParticipantRosterEnvironment(input.environmentStatus, input.environmentObservedAt)
    : input.environmentStatusCode !== null
      ? projectSalesParticipantEnvironment(input.environmentStatusCode, input.environmentObservedAt ?? undefined)
      : input.cloudShareRosterEnvironmentReference ? { dimension: "cloudshare_environment" as const, value: null, source: "not_observed" as const }
        : projectSalesParticipantEnvironment(null);
}

/** Persisted attention values may originate at an integration boundary. The
 * ordinary workspace exposes controlled operational copy only, never the
 * stored value itself. Unknown values deliberately collapse to generic copy. */
export function projectSafeSalesParticipantAttention(input: { readonly environmentAttentionReason: string | null; readonly environmentAttentionSource: string | null }): SafeSalesParticipantAttention | null {
  if (!input.environmentAttentionReason) return null;
  return {
    reason: input.environmentAttentionReason === "environment_ambiguous_for_project"
      ? "Multiple matching Participant Environments require support review."
      : input.environmentAttentionReason === "environment_not_found_for_project"
        ? "No matching Participant Environment was found; support review is required."
        : "Participant Environment resolution requires support review.",
    source: input.environmentAttentionSource === "cloudshare_v3_owner_email_item_project"
      ? "Certalis Environment correlation check"
      : "Certalis correlation",
  };
}
