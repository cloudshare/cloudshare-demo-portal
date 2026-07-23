import { projectSalesSessionStatus, type CloudShareSalesExperienceStatus } from "./sales-session-status";
import type { SalesDemoSession } from "./sales-demo-session";

export type SalesSessionQueueView = "active" | "needs_attention" | "history";
export type SalesSessionQueueSort = "start_desc" | "start_asc" | "name_asc";

export interface SalesSessionQueueCandidate extends SalesDemoSession {
  readonly accountId: string;
  readonly accountName: string;
  readonly opportunityName: string;
  readonly participantAttention?: { readonly participantName: string; readonly reason: string } | null;
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
}

export function classifySalesSessionQueueRow(session: SalesSessionQueueCandidate, now: Date): SalesSessionQueueRow {
  const status = projectSalesSessionStatus(session, now);
  const attention = status.operation.value === "needs_attention"
    ? { entity: session.sessionName ?? "Sales Enablement Session", dimension: "certalis_operation" as const, reason: status.operation.reason ?? "Certalis requires support before this operation can continue." }
    : session.participantAttention
      ? { entity: session.participantAttention.participantName, dimension: "participant_environment" as const, reason: session.participantAttention.reason }
      : undefined;
  return { id: session.id, accountId: session.accountId, accountName: session.accountName, opportunityId: session.opportunityId, opportunityName: session.opportunityName, sessionName: session.sessionName ?? "Sales Enablement Session", revision: session.revision ?? 1, start: session.start, end: session.end, timeZone: session.timeZone, operation: status.operation, experience: status.experience, ...(attention ? { attention } : {}) };
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
