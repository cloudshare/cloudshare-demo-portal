import type { DiagnosticActor } from "./diagnostic-log";
import type { SalesParticipantLaunchOperationKind, SalesParticipantLaunchOutcome } from "./sales-participant-launch-operation";
import type { SalesParticipantEnvironmentObservation } from "./sales-participant-environment";

export const invitationOutcomes = ["confirmed", "confirmed_by_reconciliation", "accepted_unconfirmed", "confirmation_required", "no_replay", "failed_retryable"] as const;
export type InvitationOutcome = typeof invitationOutcomes[number];
export type InvitationSafeReason = "not_dispatched" | "provider_rejected" | "ambiguous_after_dispatch" | "confirmation_required" | "failed_retryable" | "stale_revision" | "blocked_by_fence";

export type SalesParticipantAction = "invite" | "resend" | "generate_launch" | "revoke_launch" | "open_diagnostics";
export type SalesParticipantActionReason = "participant_concluded" | "session_ended" | "invitation_already_sent" | "invitation_not_sent" | "invitation_command_pending" | "participant_correlation_unavailable" | "native_invitations_unavailable" | "no_active_launch" | "available_to_attempt" | "unavailable_for_state";
export type SalesParticipantActionAvailability = Readonly<Record<SalesParticipantAction, { readonly available: boolean; readonly reason: SalesParticipantActionReason }>>;

export interface SalesParticipantWorkspaceRow {
  readonly id: string;
  readonly participantRevision: string;
  readonly name: string;
  readonly email: string;
  readonly invitationStatus: "sent" | "notSent";
  readonly participationStatus: "pending" | "inProgress" | "concluded";
  readonly sessionEndsAt: string;
  readonly nativeInvitationsEnabled: boolean;
  readonly providerCorrelation: boolean;
  readonly activeLaunchCapability: boolean;
  readonly currentCommandId: string | null;
  readonly invitationOutcome: InvitationOutcome | null;
  readonly invitationReason?: InvitationSafeReason | null;
  readonly invitationCorrelationId?: string | null;
  /** Latest settled/reconciliation feedback; unlike currentCommandId this is
   * attribution only and never blocks a new command. */
  readonly latestInvitationOutcome?: InvitationOutcome | null;
  readonly latestInvitationReason?: InvitationSafeReason | null;
  readonly latestInvitationCorrelationId?: string | null;
  readonly launchOperation: { readonly operation: SalesParticipantLaunchOperationKind; readonly outcome: SalesParticipantLaunchOutcome; readonly reason: "persistence_failure" | null; readonly correlationId: string | null } | null;
  readonly environment: SalesParticipantEnvironmentObservation;
  readonly environmentAttention: { readonly reason: string; readonly source: string } | null;
  readonly actionAvailability: SalesParticipantActionAvailability;
  readonly primaryAction: SalesParticipantAction | null;
}

export interface SalesParticipantWorkspacePage {
  readonly participants: readonly SalesParticipantWorkspaceRow[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}
export interface SalesParticipantWorkspaceReader { readPage(input: { customerId: string; sessionId: string; query: string; offset: number; limit: number; now: Date }): Promise<SalesParticipantWorkspacePage | null>; }
export type SalesParticipantWorkspaceBaseRow = Omit<SalesParticipantWorkspaceRow,
  "currentCommandId" | "invitationOutcome" | "invitationReason" | "invitationCorrelationId" |
  "latestInvitationOutcome" | "latestInvitationReason" | "latestInvitationCorrelationId" | "actionAvailability" | "primaryAction">;
export type SalesParticipantWorkspaceBasePage = Omit<SalesParticipantWorkspacePage, "participants"> & { readonly participants: readonly SalesParticipantWorkspaceBaseRow[] };
export interface SalesParticipantWorkspaceBaseReader { readPage(input: { customerId: string; sessionId: string; query: string; offset: number; limit: number; now: Date }): Promise<SalesParticipantWorkspaceBasePage | null>; }

/** Application-facing participant workspace boundary. Persistence and ledger
 * lifecycle details stay behind this deliberately small caller contract. */
export type SalesParticipantWorkspaceInvitationTarget = {
  readonly participantId: string;
  readonly intent: "invite" | "resend";
  readonly expectedInvitationStatus: "notSent" | "sent";
  readonly participantRevision: string;
};
export type SalesParticipantWorkspaceInvitationRequest = {
  readonly customerId: string;
  readonly sessionId: string;
  readonly actor: DiagnosticActor;
  readonly commandId: string;
  readonly targets: readonly SalesParticipantWorkspaceInvitationTarget[];
};
export type SalesParticipantWorkspaceInvitationResult = {
  readonly status: number;
  readonly body: {
    readonly outcome?: "accepted" | "in_progress" | "completed" | "needs_attention" | "rejected";
    readonly code?: string;
    readonly error?: string;
    readonly correlationId?: string | null;
  };
};
export interface SalesParticipantWorkspace extends SalesParticipantWorkspaceReader {
  submitInvitation(input: SalesParticipantWorkspaceInvitationRequest): Promise<SalesParticipantWorkspaceInvitationResult>;
}

export function eligibleParticipantActions(row: SalesParticipantWorkspaceRow, now: Date): Readonly<Record<SalesParticipantAction, boolean>> {
  const open = new Date(row.sessionEndsAt).getTime() > now.getTime();
  const base = open && row.participationStatus !== "concluded" && row.nativeInvitationsEnabled && row.providerCorrelation && row.currentCommandId === null;
  return {
    invite: base && row.invitationStatus === "notSent",
    resend: base && row.invitationStatus === "sent",
    generate_launch: open && row.participationStatus !== "concluded",
    revoke_launch: row.activeLaunchCapability,
    open_diagnostics: Boolean(row.environmentAttention || row.invitationReason || row.currentCommandId) || !base,
  };
}

export function primaryParticipantAction(row: SalesParticipantWorkspaceRow, now: Date): SalesParticipantAction | null {
  const available = eligibleParticipantActions(row, now);
  return (["invite", "generate_launch", "resend", "open_diagnostics"] as const).find((action) => available[action]) ?? null;
}

export function participantActionReason(row: SalesParticipantWorkspaceRow, action: SalesParticipantAction, now: Date): string | null {
  if (eligibleParticipantActions(row, now)[action]) return null;
  if (row.participationStatus === "concluded") return "Participant has concluded.";
  if (new Date(row.sessionEndsAt).getTime() <= now.getTime()) return "Session access window has ended.";
  if (action === "invite" && row.invitationStatus === "sent") return "Invitation already sent; choose resend.";
  if ((action === "invite" || action === "resend") && row.currentCommandId) return "An invitation command is already in progress or awaiting confirmation.";
  if ((action === "invite" || action === "resend") && !row.providerCorrelation) return "Participant correlation is unavailable.";
  if (!row.nativeInvitationsEnabled && (action === "invite" || action === "resend")) return "Native invitations are unavailable.";
  return "Action is unavailable for the current Participant state.";
}

export function projectParticipantActionAvailability(row: Omit<SalesParticipantWorkspaceRow, "actionAvailability" | "primaryAction">, now: Date): Pick<SalesParticipantWorkspaceRow, "actionAvailability" | "primaryAction"> {
  const available = eligibleParticipantActions(row as SalesParticipantWorkspaceRow, now);
  const reason = (action: SalesParticipantAction): SalesParticipantActionReason => {
    if (available[action]) return "available_to_attempt";
    if (row.participationStatus === "concluded") return "participant_concluded";
    if (new Date(row.sessionEndsAt).getTime() <= now.getTime()) return "session_ended";
    if (action === "invite" && row.invitationStatus === "sent") return "invitation_already_sent";
    if (action === "resend" && row.invitationStatus === "notSent") return "invitation_not_sent";
    if ((action === "invite" || action === "resend") && row.currentCommandId) return "invitation_command_pending";
    if ((action === "invite" || action === "resend") && !row.providerCorrelation) return "participant_correlation_unavailable";
    if ((action === "invite" || action === "resend") && !row.nativeInvitationsEnabled) return "native_invitations_unavailable";
    if (action === "revoke_launch" && !row.activeLaunchCapability) return "no_active_launch";
    return "unavailable_for_state";
  };
  const actionAvailability = Object.fromEntries((Object.keys(available) as SalesParticipantAction[]).map((action) => [action, { available: available[action], reason: reason(action) }])) as SalesParticipantActionAvailability;
  const primaryAction = (["invite", "generate_launch", "resend", "open_diagnostics"] as const).find((action) => available[action]) ?? null;
  return { actionAvailability, primaryAction };
}

export type ParticipantSelectionState = { readonly activeId: string | null; readonly selectedIds: readonly string[]; readonly rangeAnchorId: string | null };
export type ParticipantSelectionEvent =
  | { readonly type: "click"; readonly id: string; readonly additive?: boolean; readonly range?: boolean; readonly pageIds?: readonly string[] }
  | { readonly type: "move"; readonly direction: "next" | "previous"; readonly pageIds: readonly string[] }
  | { readonly type: "toggle"; readonly id: string; readonly range?: boolean; readonly pageIds?: readonly string[] }
  | { readonly type: "nested_control"; readonly id: string; readonly control: "button" | "link" | "input" | "menu" | "dialog" }
  | { readonly type: "clear" };

export function reduceParticipantSelection(state: ParticipantSelectionState, event: ParticipantSelectionEvent): ParticipantSelectionState {
  if (event.type === "clear") return { activeId: null, selectedIds: [], rangeAnchorId: null };
  if (event.type === "nested_control") return state;
  if (event.type === "move") {
    const index = state.activeId ? event.pageIds.indexOf(state.activeId) : -1;
    const next = event.direction === "next" ? Math.min(event.pageIds.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
    return { ...state, activeId: event.pageIds[next] ?? null };
  }
  if (event.type === "toggle" || event.type === "click") {
    const selected = new Set(state.selectedIds);
    if (event.range && "pageIds" in event) {
      const anchor = state.rangeAnchorId ?? event.id;
      const pageIds = event.pageIds ?? [];
      const start = pageIds.indexOf(anchor), end = pageIds.indexOf(event.id);
      if (start >= 0 && end >= 0) for (const id of pageIds.slice(Math.min(start, end), Math.max(start, end) + 1)) selected.add(id);
      return { activeId: event.id, selectedIds: [...selected], rangeAnchorId: anchor };
    }
    if (event.type === "toggle" || event.additive) {
      selected.has(event.id) ? selected.delete(event.id) : selected.add(event.id);
      return { activeId: event.id, selectedIds: [...selected], rangeAnchorId: state.rangeAnchorId ?? event.id };
    }
    selected.clear();
    selected.add(event.id);
    return { activeId: event.id, selectedIds: [...selected], rangeAnchorId: event.id };
  }
  return state;
}

/** Keep selection local to the currently rendered page. When the focused row
 * disappears, focus the first visible row so keyboard users never lose the
 * workspace's logical focus. */
export function pruneParticipantSelection(state: ParticipantSelectionState, pageIds: readonly string[]): ParticipantSelectionState {
  const visible = new Set(pageIds);
  const selectedIds = state.selectedIds.filter((id) => visible.has(id));
  const rangeAnchorId = state.rangeAnchorId && visible.has(state.rangeAnchorId) ? state.rangeAnchorId : null;
  const activeId = state.activeId && visible.has(state.activeId) ? state.activeId : pageIds[0] ?? null;
  return { activeId, selectedIds, rangeAnchorId };
}

export function validateParticipantPage(input: { readonly query?: string; readonly offset?: number; readonly limit?: number }): { readonly query: string; readonly offset: number; readonly limit: number } | null {
  const query = (input.query ?? "").trim();
  const offset = input.offset ?? 0, limit = input.limit ?? 25;
  return query.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10_000 || !Number.isInteger(limit) || limit < 1 || limit > 50 ? null : { query, offset, limit };
}
