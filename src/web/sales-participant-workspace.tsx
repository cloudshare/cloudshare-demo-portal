"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./sales-session-workspace.module.css";
import type { SalesParticipantWorkspaceRow } from "@/domain/sales-participant-workspace";
import {
  participantActionReason,
  pruneParticipantSelection,
  reduceParticipantSelection,
  type ParticipantSelectionState,
} from "@/domain/sales-participant-workspace";

type ParticipantPage = {
  readonly participants: readonly SalesParticipantWorkspaceRow[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
};
type Action = "invite" | "resend" | "generate_launch" | "revoke_launch";

export function SalesParticipantWorkspace(props: {
  readonly sessionId: string;
  readonly active: boolean;
  readonly request: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const { sessionId, active, request } = props;
  const [page, setPage] = useState<ParticipantPage | null>(null);
  const initial = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(initial?.get("participantQuery") ?? "");
  const [offset, setOffset] = useState(Number(initial?.get("participantOffset") ?? 0) || 0);
  const [selection, setSelection] = useState<ParticipantSelectionState>({ activeId: null, selectedIds: [], rangeAnchorId: null });
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const inspectorRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [revokeTarget, setRevokeTarget] = useState<SalesParticipantWorkspaceRow | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const href = useCallback(() => `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/page?${query ? `query=${encodeURIComponent(query)}&` : ""}offset=${offset}&limit=25`, [offset, query, sessionId]);
  const activeParticipant = page?.participants.find((row) => row.id === selection.activeId) ?? null;

  useEffect(() => {
    if (active) headingRef.current?.focus();
  }, [active]);
  useEffect(() => {
    const onPop = () => { const params = new URLSearchParams(window.location.search); setQuery(params.get("participantQuery") ?? ""); setOffset(Number(params.get("participantOffset") ?? 0) || 0); window.scrollTo(0, window.history.state?.participantScrollY ?? 0); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href); query ? url.searchParams.set("participantQuery", query) : url.searchParams.delete("participantQuery"); offset ? url.searchParams.set("participantOffset", String(offset)) : url.searchParams.delete("participantOffset");
    window.history.replaceState({ ...window.history.state, participantScrollY: window.scrollY }, "", url);
  }, [active, offset, query]);
  useEffect(() => {
    if (!active) return;
    void request(href(), { cache: "no-store" }).then(async (response) => {
      const body = (await response.json()) as ParticipantPage;
      if (!response.ok || !Array.isArray(body.participants)) { setFeedback((current) => ({ ...current, _announcement: "Participant roster could not be loaded; retry or open Support." })); return; }
      setPage(body);
      setSelection((current) => pruneParticipantSelection(current, body.participants.map((row) => row.id)));
    }).catch(() => undefined);
  }, [active, href, request]);
  useEffect(() => {
    if (inspectorOpen) inspectorRef.current?.focus();
    else if (selection.activeId) Array.from(document.querySelectorAll<HTMLElement>("tr[data-participant-id]")).find((row) => row.dataset.participantId === selection.activeId)?.focus();
  }, [inspectorOpen, selection.activeId]);

  const runAction = async (participant: SalesParticipantWorkspaceRow, action: Action) => {
    if (action === "revoke_launch") { originRef.current = document.activeElement as HTMLElement; setRevokeTarget(participant); return; }
    setFeedback((current) => ({ ...current, [participant.id]: "Working…" }));
    try {
      const invite = action === "invite" || action === "resend";
      const url = invite ? `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/invite` : `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participant.id)}/launch-link`;
      const body = invite ? JSON.stringify({ commandId: crypto.randomUUID(), targets: [{ participantId: participant.id, intent: action, expectedInvitationStatus: participant.invitationStatus, participantRevision: participant.participantRevision }] }) : undefined;
      const response = await request(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body });
      const result = (await response.json()) as { error?: string; correlationId?: string; launchUrl?: string };
      if (!response.ok) throw new Error(result.error ?? `Action failed (${response.status}).`);
      setFeedback((current) => ({ ...current, [participant.id]: result.launchUrl ? `Launch link ready: ${result.launchUrl}` : result.correlationId ? `Completed. Correlation ${result.correlationId}.` : "Completed." }));
      if (result.launchUrl) window.open(result.launchUrl, "_blank", "noopener,noreferrer");
      const reread = await request(href(), { cache: "no-store" });
      const next = (await reread.json()) as ParticipantPage;
      if (reread.ok && Array.isArray(next.participants)) setPage(next);
    } catch (cause) {
      setFeedback((current) => ({ ...current, [participant.id]: cause instanceof Error ? cause.message : "Action failed; retry or open Support." }));
    }
  };
  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    const response = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(target.id)}/launch-link`, { method: "DELETE" });
    const result = (await response.json()) as { error?: string };
    setFeedback((current) => ({ ...current, [target.id]: response.ok ? "Launch link revoked." : result.error ?? "Revoke failed; retry or open Support." }));
    queueMicrotask(() => originRef.current?.focus());
  };
  return <>
    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><h2 ref={headingRef} tabIndex={-1}>Participants</h2><p>Bounded Participant workspace page.</p></div><span className={styles.count}>{page?.total ?? 0} participants</span></div>
      <label htmlFor="participant-query">Search Participants</label>
      <input id="participant-query" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Search name or email" />
      {page?.participants.length ? <div className={styles.tableWrap}><table aria-label="Participant roster" className={styles.roster}><thead><tr><th>Participant</th><th>Invitation</th><th>Participation</th><th>Participant Environment</th><th>Environment source</th></tr></thead><tbody>{page.participants.map((participant, index) => { const selected = selection.selectedIds.includes(participant.id); const current = selection.activeId === participant.id; const pageIds = page.participants.map((row) => row.id); return <tr key={participant.id} data-participant-id={participant.id} data-active={current ? "true" : undefined} data-selected={selected ? "true" : undefined} tabIndex={current ? 0 : -1} onClick={(event) => { if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) return; setSelection((state) => reduceParticipantSelection(state, { type: "click", id: participant.id, additive: event.ctrlKey || event.metaKey, range: event.shiftKey, pageIds })); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelection((state) => reduceParticipantSelection(state, { type: "move", direction: event.key === "ArrowDown" ? "next" : "previous", pageIds })); } else if (event.key === " ") { event.preventDefault(); setSelection((state) => reduceParticipantSelection(state, { type: "toggle", id: participant.id, range: event.shiftKey, pageIds })); } else if (event.key === "Enter") { event.preventDefault(); setSelection((state) => ({ ...state, activeId: participant.id })); setInspectorOpen(true); } }}><th scope="row"><strong>{participant.name}</strong><span>{participant.email}</span><button type="button" onClick={() => { setSelection((state) => ({ ...state, activeId: participant.id })); setInspectorOpen(true); }}>Inspect</button></th><td><span className={styles.inlineBadge}>{participant.invitationStatus === "sent" ? "Sent" : "Not sent"}</span></td><td><span className={styles.inlineBadge}>{participant.participationStatus === "inProgress" ? "In progress" : participant.participationStatus === "concluded" ? "Concluded" : "Pending"}</span></td><td>{participant.environment.value ?? "Not observed"}</td><td>{humanEnvironmentSource(participant.environment.source)}</td></tr>; })}</tbody></table></div> : <p className={styles.empty}>No Participants are registered for this Sales Session.</p>}
      {offset > 0 ? <button type="button" onClick={() => setOffset(Math.max(0, offset - 25))}>Previous</button> : null}{page?.hasMore ? <button type="button" onClick={() => setOffset(offset + 25)}>Next</button> : null}
    </section>
    {revokeTarget ? <div role="dialog" aria-modal="true" aria-label="Confirm revoke launch link" className={styles.panel}><p>Revoke the launch link for {revokeTarget.name}?</p><button type="button" onClick={() => void confirmRevoke()}>Revoke</button><button type="button" onClick={() => setRevokeTarget(null)}>Cancel</button></div> : null}
    {activeParticipant && inspectorOpen ? <aside ref={inspectorRef} tabIndex={-1} className={styles.panel} aria-label="Participant inspector" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setInspectorOpen(false); } }}><div className={styles.panelHeading}><div><h2>Participant inspector</h2><p>{activeParticipant.name} · {activeParticipant.email}</p></div><button type="button" onClick={() => setInspectorOpen(false)}>Close</button></div><p>Invitation: <strong>{activeParticipant.invitationStatus}</strong> · Participation: <strong>{activeParticipant.participationStatus}</strong></p><div role="group" aria-label="Participant actions" className={styles.inspectorActions}>{(["invite", "resend", "generate_launch", "revoke_launch"] as const).map((action) => { const reason = participantActionReason(activeParticipant, action, new Date()); return <button key={action} type="button" disabled={Boolean(reason)} title={reason ?? undefined} onClick={() => void runAction(activeParticipant, action)}>{action === "generate_launch" ? "Generate launch link" : action === "revoke_launch" ? "Revoke launch link" : action[0].toUpperCase() + action.slice(1)}</button>; })}</div>{feedback[activeParticipant.id] ? <p role="status" aria-live="polite">{feedback[activeParticipant.id]}</p> : null}<p><a href={`/sales?tab=activity&sessionId=${encodeURIComponent(sessionId)}`}>View Activity</a> · <a href="/sales?tab=support">Open Support</a></p></aside> : null}
  </>;
}

function humanEnvironmentSource(value: string): string {
  if (value === "cloudshare_v3_environment") return "Observed from CloudShare Environment";
  if (value === "cloudshare_v4_sales_participant_roster") return "Observed from CloudShare participant roster";
  if (value === "not_assigned") return "No CloudShare Environment is assigned";
  return "CloudShare Environment state has not been observed";
}
