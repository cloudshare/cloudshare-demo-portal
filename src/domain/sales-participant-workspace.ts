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
}

export interface SalesParticipantWorkspacePage {
  readonly participants: readonly SalesParticipantWorkspaceRow[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}

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

export type ParticipantSelectionState = { readonly activeId: string | null; readonly selectedIds: readonly string[]; readonly rangeAnchorId: string | null };
export type ParticipantSelectionEvent =
  | { readonly type: "click"; readonly id: string; readonly additive?: boolean; readonly range?: boolean }
  | { readonly type: "move"; readonly direction: "next" | "previous"; readonly pageIds: readonly string[] }
  | { readonly type: "toggle"; readonly id: string; readonly range?: boolean }
  | { readonly type: "clear" };

export function reduceParticipantSelection(state: ParticipantSelectionState, event: ParticipantSelectionEvent): ParticipantSelectionState {
  if (event.type === "clear") return { activeId: null, selectedIds: [], rangeAnchorId: null };
  if (event.type === "move") {
    const index = state.activeId ? event.pageIds.indexOf(state.activeId) : -1;
    const next = event.direction === "next" ? Math.min(event.pageIds.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
    return { ...state, activeId: event.pageIds[next] ?? null, rangeAnchorId: event.pageIds[next] ?? null };
  }
  const index = event.type === "click" || event.type === "toggle" ? undefined : undefined;
  if (event.type === "toggle" || event.type === "click") {
    const selected = new Set(state.selectedIds);
    if (event.range) return { activeId: event.id, selectedIds: [...selected, event.id], rangeAnchorId: state.rangeAnchorId ?? event.id };
    if (event.type === "toggle" || event.additive) selected.has(event.id) ? selected.delete(event.id) : selected.add(event.id);
    else { selected.clear(); selected.add(event.id); }
    return { activeId: event.id, selectedIds: [...selected], rangeAnchorId: state.rangeAnchorId ?? event.id };
  }
  return state;
}
