export type ParticipantRowInteraction = { readonly activeId: string | null; readonly selectedIds: ReadonlySet<string>; readonly anchorId: string | null; readonly focus: "row" | "inspector" };
export type ParticipantRowEvent = { readonly type: "move"; readonly direction: "next" | "previous"; readonly ids: readonly string[] } | { readonly type: "select"; readonly id: string; readonly shift?: boolean; readonly toggle?: boolean; readonly ids: readonly string[] } | { readonly type: "inspect"; readonly id: string } | { readonly type: "escape" };

export function reconcileParticipantRowInteraction(state: ParticipantRowInteraction, ids: readonly string[]): ParticipantRowInteraction {
  const activeId = state.activeId && ids.includes(state.activeId) ? state.activeId : ids[0] ?? null;
  const selectedIds = new Set([...state.selectedIds].filter((id) => ids.includes(id)));
  if (activeId && selectedIds.size === 0) selectedIds.add(activeId);
  return { ...state, activeId, anchorId: state.anchorId && ids.includes(state.anchorId) ? state.anchorId : activeId, selectedIds };
}

export function reduceParticipantRowInteraction(state: ParticipantRowInteraction, event: ParticipantRowEvent): ParticipantRowInteraction {
  if (event.type === "move") {
    const index = state.activeId ? event.ids.indexOf(state.activeId) : -1;
    const next = event.direction === "next" ? Math.min(event.ids.length - 1, index + 1) : Math.max(0, index - 1);
    return { ...state, activeId: event.ids[next] ?? null, focus: "row" };
  }
  if (event.type === "inspect") return { ...state, activeId: event.id, anchorId: event.id, focus: "inspector" };
  if (event.type === "escape") return { ...state, focus: "row" };
  const next = new Set(state.selectedIds);
  if (event.shift && state.anchorId) {
    next.clear(); const a = event.ids.indexOf(state.anchorId); const b = event.ids.indexOf(event.id);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) if (event.ids[i]) next.add(event.ids[i]);
  } else if (event.toggle) next.has(event.id) ? next.delete(event.id) : next.add(event.id);
  else { next.clear(); next.add(event.id); }
  return { ...state, activeId: event.id, anchorId: event.id, selectedIds: next, focus: "row" };
}

export function focusParticipantRow(id: string | null, documentLike: Pick<Document, "getElementById">): void {
  if (!id) return;
  const element = documentLike.getElementById(`participant-${id}`);
  if (element instanceof HTMLElement) element.focus();
}
