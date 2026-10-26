import { projectSalesSessionStatus, type CloudShareSalesExperienceStatus } from "./sales-session-status";
import type { SalesDemoSession } from "./sales-demo-session";
import { projectSalesParticipantV4Environment, projectSalesParticipantEnvironment, projectSalesParticipantRosterEnvironment, isProjectableSalesParticipantRosterEnvironment, type SalesParticipantEnvironmentObservation } from "./sales-participant-environment";

export type SalesSessionQueueView = "active" | "needs_attention" | "history";
export type SalesSessionQueueSort = "start_desc" | "start_asc" | "name_asc";
export interface SalesSessionQueueParticipantEnvironment { readonly participantName: string; readonly observation: SalesParticipantEnvironmentObservation; readonly attentionReason?: string | null; }

export interface SalesSessionQueueCandidate extends SalesDemoSession {
  readonly accountId: string;
  readonly accountName: string;
  readonly opportunityName: string;
  readonly participantEnvironment?: SalesSessionQueueParticipantEnvironment | null;
}

export interface SalesSessionQueueRow {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly opportunityId: string;
  readonly opportunityName: string;
  readonly sessionName: string;
  readonly revision: number;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly operation: ReturnType<typeof projectSalesSessionStatus>["operation"];
  readonly experience: ReturnType<typeof projectSalesSessionStatus>["experience"];
  readonly attention?: { readonly entity: string; readonly dimension: "certalis_operation" | "participant_environment"; readonly reason: string };
  readonly participantEnvironment?: SalesSessionQueueParticipantEnvironment;
}

export function classifySalesSessionQueueRow(session: SalesSessionQueueCandidate, now: Date): SalesSessionQueueRow {
  const status = projectSalesSessionStatus(session, now);
  const attention = status.operation.value === "needs_attention"
    ? { entity: session.sessionName ?? "Sales Enablement Session", dimension: "certalis_operation" as const, reason: status.operation.reason ?? "Certalis requires support before this operation can continue." }
    : session.participantEnvironment?.attentionReason
      ? { entity: session.participantEnvironment.participantName, dimension: "participant_environment" as const, reason: session.participantEnvironment.attentionReason }
      : undefined;
  return { id: session.id, accountId: session.accountId, accountName: session.accountName, opportunityId: session.opportunityId, opportunityName: session.opportunityName, sessionName: session.sessionName ?? "Sales Enablement Session", revision: session.revision ?? 1, start: session.start, end: session.end, timeZone: session.timeZone, operation: status.operation, experience: status.experience, ...(session.participantEnvironment ? { participantEnvironment: session.participantEnvironment } : {}), ...(attention ? { attention } : {}) };
}

export function projectQueueParticipantEnvironment(input: { readonly v4EnvironmentStatus?: string | null; readonly v4EnvironmentObservedAt?: Date | null; readonly participantName: string; readonly environmentStatus: string | null; readonly environmentStatusCode: number | null; readonly environmentObservedAt: Date | null; readonly attentionReason: string | null }): SalesSessionQueueParticipantEnvironment {
  const observation = input.v4EnvironmentStatus && input.v4EnvironmentObservedAt && (!input.environmentObservedAt || input.v4EnvironmentObservedAt >= input.environmentObservedAt) ? projectSalesParticipantV4Environment(input.v4EnvironmentStatus, input.v4EnvironmentObservedAt) : input.environmentStatus && input.environmentObservedAt && isProjectableSalesParticipantRosterEnvironment(input.environmentStatus)
    ? projectSalesParticipantRosterEnvironment(input.environmentStatus, input.environmentObservedAt)
    : projectSalesParticipantEnvironment(input.environmentStatusCode, input.environmentObservedAt ?? undefined);
  return { participantName: input.participantName, observation, attentionReason: input.attentionReason };
}

export function belongsInSalesSessionQueue(row: SalesSessionQueueRow, view: SalesSessionQueueView): boolean {
  if (view === "needs_attention") return Boolean(row.attention);
  if (view === "history") return row.experience.value === "ended";
  return row.experience.value === "notStarted" || row.experience.value === "inProgress";
}

export function parseSalesSessionQueueView(value: string | null | undefined): SalesSessionQueueView {
  // The older names stay parseable in bookmarked links while the public queue
  // vocabulary remains the agreed Active / Needs attention / History model.
  if (value === "needs_attention") return "needs_attention";
  if (value === "history" || value === "ended") return "history";
  return "active";
}

export function parseSalesSessionQueueSort(value: string | null | undefined): SalesSessionQueueSort {
  return value === "start_asc" || value === "name_asc" ? value : "start_desc";
}

export function isExperienceStatus(value: unknown): value is CloudShareSalesExperienceStatus {
  return value === "notStarted" || value === "inProgress" || value === "ended";
}
