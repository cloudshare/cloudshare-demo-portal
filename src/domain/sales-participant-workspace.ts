export type SalesParticipantAction = "invite" | "resend" | "generate_launch" | "revoke_launch" | "open_diagnostics";

export interface SalesParticipantWorkspaceRow {
  readonly id: string;
  readonly participantRevision: string;
  readonly name: string;
  readonly email: string;
  readonly invitationStatus: "sent" | "notSent";
  readonly participationStatus: string;
  readonly sessionEndsAt: string;
  readonly nativeInvitationsEnabled: boolean;
  readonly providerCorrelation: boolean;
  readonly activeLaunchCapability: boolean;
  readonly currentCommandId: string | null;
  readonly invitationOutcome: string | null;
  readonly invitationReason?: string | null;
  readonly invitationCorrelationId?: string | null;
  readonly invitationRevision?: number | null;
  readonly launchOperation: { readonly outcome: string; readonly correlationId: string | null } | null;
  readonly environment: { readonly value: string | null; readonly source: string; readonly observedAt?: string };
  readonly environmentAttention: { readonly reason: string; readonly source: string } | null;
}

export interface SalesParticipantWorkspacePage {
  readonly participants: readonly SalesParticipantWorkspaceRow[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}
export interface SalesParticipantWorkspaceReader { readPage(input: { customerId: string; sessionId: string; query: string; offset: number; limit: number; now: Date }): Promise<SalesParticipantWorkspacePage | null>; }

export function eligibleParticipantActions(row: SalesParticipantWorkspaceRow, now: Date): Readonly<Record<SalesParticipantAction, boolean>> {
  const open = new Date(row.sessionEndsAt).getTime() > now.getTime();
  const base = open && row.participationStatus !== "concluded" && row.nativeInvitationsEnabled && row.providerCorrelation;
  return {
    invite: base && row.invitationStatus === "notSent",
    resend: base && row.invitationStatus === "sent",
    generate_launch: open && row.participationStatus !== "concluded",
    revoke_launch: row.activeLaunchCapability,
    open_diagnostics: !base || row.participationStatus === "concluded",
  };
}

export function participantActionReason(row: SalesParticipantWorkspaceRow, action: SalesParticipantAction, now: Date): string | null {
  if (eligibleParticipantActions(row, now)[action]) return null;
  if (row.participationStatus === "concluded") return "Participant has concluded.";
  if (new Date(row.sessionEndsAt).getTime() <= now.getTime()) return "Session access window has ended.";
  if (action === "invite" && row.invitationStatus === "sent") return "Invitation already sent; choose resend.";
  if (!row.providerCorrelation) return "Participant correlation is unavailable.";
  if (!row.nativeInvitationsEnabled && (action === "invite" || action === "resend")) return "Native invitations are unavailable.";
  return "Action is unavailable for the current Participant state.";
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
    if (event.type === "toggle" || event.additive) selected.has(event.id) ? selected.delete(event.id) : selected.add(event.id);
    else { selected.clear(); selected.add(event.id); }
    return { activeId: event.id, selectedIds: [...selected], rangeAnchorId: state.rangeAnchorId ?? event.id };
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
