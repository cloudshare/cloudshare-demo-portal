"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import styles from "./sales-session-workspace.module.css";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import type { SalesParticipantWorkspaceRow } from "@/domain/sales-participant-workspace";
import {
  participantActionReason,
  primaryParticipantAction,
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
  const [selection, setSelection] = useState<ParticipantSelectionState>(() => {
    if (typeof window === "undefined") return { activeId: null, selectedIds: [], rangeAnchorId: null };
    const params = new URLSearchParams(window.location.search);
    return { activeId: params.get("participantActive"), selectedIds: (params.get("participantSelected") ?? "").split(",").filter(Boolean).slice(0, 25), rangeAnchorId: params.get("participantAnchor") };
  });
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("participantFocus") === "inspector" && Boolean(new URLSearchParams(window.location.search).get("participantActive")));
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const inspectorRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [revokeTarget, setRevokeTarget] = useState<SalesParticipantWorkspaceRow | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const historyMode = useRef<"push" | "replace">("replace");
  const lastUrl = useRef<string | null>(null);
  const logicalFocus = useRef<"row" | "inspector">(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("participantFocus") === "inspector" ? "inspector" : "row");
  const href = useCallback(() => `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/page?${query ? `query=${encodeURIComponent(query)}&` : ""}offset=${offset}&limit=25`, [offset, query, sessionId]);
  const activeParticipant = page?.participants.find((row) => row.id === selection.activeId) ?? null;

  useEffect(() => {
    if (active) headingRef.current?.focus();
  }, [active]);
  useEffect(() => {
    const onPop = () => { const params = new URLSearchParams(window.location.search); const inspector = params.get("participantFocus") === "inspector" && Boolean(params.get("participantActive")); historyMode.current = "replace"; lastUrl.current = window.location.href; setQuery(params.get("participantQuery") ?? ""); setOffset(Number(params.get("participantOffset") ?? 0) || 0); setSelection({ activeId: params.get("participantActive"), selectedIds: (params.get("participantSelected") ?? "").split(",").filter(Boolean).slice(0, 25), rangeAnchorId: params.get("participantAnchor") }); logicalFocus.current = inspector ? "inspector" : "row"; setInspectorOpen(inspector); const scrollY = window.history.state?.participantScrollY; if (typeof scrollY === "number" && typeof window.scrollTo === "function") window.scrollTo(0, scrollY); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href); query ? url.searchParams.set("participantQuery", query) : url.searchParams.delete("participantQuery"); offset ? url.searchParams.set("participantOffset", String(offset)) : url.searchParams.delete("participantOffset"); selection.activeId ? url.searchParams.set("participantActive", selection.activeId) : url.searchParams.delete("participantActive"); selection.selectedIds.length ? url.searchParams.set("participantSelected", selection.selectedIds.slice(0, 25).join(",")) : url.searchParams.delete("participantSelected"); selection.rangeAnchorId ? url.searchParams.set("participantAnchor", selection.rangeAnchorId) : url.searchParams.delete("participantAnchor"); url.searchParams.set("participantFocus", logicalFocus.current);
    const nextUrl = url.toString();
    if (lastUrl.current === nextUrl) return;
    const method = historyMode.current === "push" ? "pushState" : "replaceState";
    window.history[method]({ ...window.history.state, participantScrollY: window.scrollY }, "", url);
    lastUrl.current = nextUrl;
    historyMode.current = "replace";
  }, [active, inspectorOpen, offset, query, selection]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void request(href(), { cache: "no-store" }).then(async (response) => {
      if (disposed) return;
      const body = (await response.json()) as ParticipantPage;
      if (disposed) return;
      if (!response.ok || !Array.isArray(body.participants)) { setFeedback((current) => ({ ...current, _announcement: "Participant roster could not be loaded; retry or open Support." })); return; }
      setPage(body);
      setSelection((current) => {
        const next = pruneParticipantSelection(current, body.participants.map((row) => row.id));
        if (current.activeId !== next.activeId || current.rangeAnchorId !== next.rangeAnchorId || current.selectedIds.join(",") !== next.selectedIds.join(",")) {
          historyMode.current = "replace";
          if (current.activeId || current.rangeAnchorId || current.selectedIds.length) setFeedback((messages) => ({ ...messages, _announcement: "The Participant roster changed; the previous selection is no longer visible." }));
        }
        return next;
      });
    }).catch(() => { if (!disposed) setFeedback((messages) => ({ ...messages, _announcement: "Participant roster could not be loaded; retry or open Support." })); });
    return () => { disposed = true; };
  }, [active, href, request]);
  useEffect(() => {
    if (inspectorOpen) inspectorRef.current?.focus();
    else if (logicalFocus.current === "row" && selection.activeId && !(document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLInputElement)) Array.from(document.querySelectorAll<HTMLElement>("tr[data-participant-id]")).find((row) => row.dataset.participantId === selection.activeId)?.focus();
  }, [activeParticipant?.id, inspectorOpen, selection.activeId]);

  const openInspector = (participantId: string, origin: HTMLElement | null) => {
    historyMode.current = "push";
    logicalFocus.current = "inspector";
    originRef.current = origin?.closest<HTMLElement>("tr[data-participant-id]") ?? headingRef.current;
    setSelection((state) => ({ ...state, activeId: participantId }));
    setInspectorOpen(true);
  };
  const closeInspector = () => {
    historyMode.current = "push";
    logicalFocus.current = "row";
    setInspectorOpen(false);
    queueMicrotask(() => (originRef.current ?? headingRef.current)?.focus());
  };

  const rereadWorkspace = async () => {
    try {
      const response = await request(href(), { cache: "no-store" });
      const next = await readJsonObject(response);
      if (response.ok && Array.isArray(next?.participants)) setPage(next as ParticipantPage);
    } catch {
      // Action feedback is more useful than replacing it with a secondary reread failure.
    }
  };

  const runAction = async (participant: SalesParticipantWorkspaceRow, action: Action) => {
    if (action === "revoke_launch") { logicalFocus.current = "inspector"; originRef.current = document.activeElement as HTMLElement; setRevokeTarget(participant); return; }
    setFeedback((current) => ({ ...current, [participant.id]: "Working…" }));
    try {
      const invite = action === "invite" || action === "resend";
      const url = invite ? `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/invite` : `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participant.id)}/launch-link`;
      const body = invite ? JSON.stringify({ commandId: crypto.randomUUID(), targets: [{ participantId: participant.id, intent: action, expectedInvitationStatus: participant.invitationStatus, participantRevision: participant.participantRevision }] }) : undefined;
      const response = await request(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body });
      const result = await readJsonObject(response);
      const code = textField(result, "code");
      const outcome = textField(result, "outcome");
      const correlationId = textField(result, "correlationId");
      const launchUrl = textField(result, "launchUrl");
      if (!response.ok) throw new Error(code === "no_replay" ? "No replay permitted: provider outcome is ambiguous; open Support." : textField(result, "error") ?? `Action failed (${response.status}).`);
      if (launchUrl) {
        const launch = new URL(launchUrl, window.location.origin);
        if (launch.origin !== window.location.origin || !launch.pathname.startsWith("/sales/launch/")) throw new Error("Launch link was rejected because it was not a Certalis portal link.");
      }
      const confirmationPending = response.status === 202 || code === "confirmation_required" || outcome === "confirmation_required" || outcome === "in_progress";
      const message = confirmationPending ? `Confirmation pending; the replay fence is retained.${correlationId ? ` Correlation ${correlationId}.` : ""}` : outcome === "completed_with_unconfirmed" ? `Completed with confirmation pending; the replay fence is retained.${correlationId ? ` Correlation ${correlationId}.` : ""}` : outcome === "failed_retryable" ? "Action failed temporarily; retry is available." : launchUrl ? "Launch link ready." : correlationId ? `Completed. Correlation ${correlationId}.` : "Completed.";
      setFeedback((current) => ({ ...current, [participant.id]: message }));
      if (launchUrl) window.open(new URL(launchUrl, window.location.origin).toString(), "_blank", "noopener,noreferrer");
    } catch (cause) {
      setFeedback((current) => ({ ...current, [participant.id]: cause instanceof Error ? cause.message : "Action failed; retry or open Support." }));
    } finally {
      await rereadWorkspace();
    }
  };
  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    try {
      const response = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(target.id)}/launch-link`, { method: "DELETE" });
      const result = await readJsonObject(response);
      const correlationId = textField(result, "correlationId");
      const correlation = correlationId ? ` Correlation ${correlationId}.` : "";
      setFeedback((current) => ({ ...current, [target.id]: response.ok ? `Launch link revoked.${correlation}` : `${textField(result, "error") ?? `Revoke failed (${response.status}); retry or open Support.`}${correlation}` }));
    } catch {
      setFeedback((current) => ({ ...current, [target.id]: "Revoke failed; retry or open Support." }));
    } finally {
      await rereadWorkspace();
      queueMicrotask(() => originRef.current?.focus());
    }
  };
  return <>
    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><h2 ref={headingRef} tabIndex={-1}>Participants</h2><p>Bounded Participant workspace page.</p></div><span className={styles.count}>{page?.total ?? 0} participants · {selection.selectedIds.length} selected</span></div>
      <label htmlFor="participant-query">Search Participants</label>
      <input id="participant-query" value={query} onChange={(event) => { historyMode.current = "push"; setQuery(event.target.value); setOffset(0); }} placeholder="Search name or email" />
      {feedback._announcement ? <p role="alert" aria-live="polite">{feedback._announcement}</p> : null}
      {page?.participants.length ? <div className={styles.tableWrap} role="region" aria-label="Scrollable Participant roster" tabIndex={0}><table aria-label="Participant roster" className={styles.roster}><thead><tr><th>Participant</th><th>Invitation</th><th>Participation</th><th>Participant Environment</th><th>Environment source</th></tr></thead><tbody>{page.participants.map((participant) => { const selected = selection.selectedIds.includes(participant.id); const current = selection.activeId === participant.id; const pageIds = page.participants.map((row) => row.id); return <tr key={participant.id} aria-selected={selected} data-participant-id={participant.id} data-active={current ? "true" : undefined} data-selected={selected ? "true" : undefined} tabIndex={current ? 0 : -1} onClick={(event) => { if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) return; historyMode.current = "push"; setSelection((state) => reduceParticipantSelection(state, { type: "click", id: participant.id, additive: event.ctrlKey || event.metaKey, range: event.shiftKey, pageIds })); }} onKeyDown={(event) => { if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) return; historyMode.current = "push"; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelection((state) => reduceParticipantSelection(state, { type: "move", direction: event.key === "ArrowDown" ? "next" : "previous", pageIds })); } else if (event.key === " ") { event.preventDefault(); setSelection((state) => reduceParticipantSelection(state, { type: "toggle", id: participant.id, range: event.shiftKey, pageIds })); } else if (event.key === "Enter") { event.preventDefault(); openInspector(participant.id, event.currentTarget); } }}><th scope="row"><strong>{participant.name}</strong><span>{participant.email}</span><button type="button" onClick={(event) => openInspector(participant.id, event.currentTarget)}>Inspect</button></th><td><span className={styles.inlineBadge}>{participant.invitationStatus === "sent" ? "Sent" : "Not sent"}</span></td><td><span className={styles.inlineBadge}>{participant.participationStatus === "inProgress" ? "In progress" : participant.participationStatus === "concluded" ? "Concluded" : "Pending"}</span></td><td>{participant.environment.value ?? "Not observed"}</td><td>{humanEnvironmentSource(participant.environment.source)}</td></tr>; })}</tbody></table></div> : <p className={styles.empty}>No Participants are registered for this Sales Session.</p>}
      {offset > 0 ? <button type="button" onClick={() => { historyMode.current = "push"; setOffset(Math.max(0, offset - 25)); }}>Previous</button> : null}{page?.hasMore ? <button type="button" onClick={() => { historyMode.current = "push"; setOffset(offset + 25); }}>Next</button> : null}
    </section>
    {revokeTarget ? <div role="dialog" aria-modal="true" aria-label="Confirm revoke launch link" className={styles.panel} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRevokeTarget(null); queueMicrotask(() => originRef.current?.focus()); } if (event.key === "Tab") { const buttons = Array.from(event.currentTarget.querySelectorAll("button")); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); const next = buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]; event.preventDefault(); next?.focus(); } }}><p>Revoke the launch link for {revokeTarget.name}?</p><button autoFocus type="button" onClick={() => void confirmRevoke()}>Revoke</button><button type="button" onClick={() => { setRevokeTarget(null); queueMicrotask(() => originRef.current?.focus()); }}>Cancel</button></div> : null}
    {activeParticipant && inspectorOpen ? <ParticipantInspector participant={activeParticipant} sessionId={sessionId} inspectorRef={inspectorRef} feedback={feedback[activeParticipant.id]} onClose={closeInspector} onAction={runAction} /> : null}
  </>;
}

function ParticipantInspector({ participant, sessionId, inspectorRef, feedback, onClose, onAction }: { participant: SalesParticipantWorkspaceRow; sessionId: string; inspectorRef: React.RefObject<HTMLElement | null>; feedback?: string; onClose: () => void; onAction: (participant: SalesParticipantWorkspaceRow, action: Action) => Promise<void> }) {
  const now = new Date();
  const primary = primaryParticipantAction(participant, now);
  return <aside ref={inspectorRef} tabIndex={-1} className={styles.panel} aria-label="Participant inspector" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}><div className={styles.panelHeading}><div><h2>Participant inspector</h2><p>{participant.name} · {participant.email}</p></div><button type="button" onClick={onClose}>Close</button></div><p>Invitation: <strong>{participant.invitationStatus}</strong> · Participation: <strong>{participant.participationStatus}</strong></p><p>Environment state: <strong>{participant.environment.value ?? "Not observed"}</strong></p><p>Environment source: <strong>{humanEnvironmentSource(participant.environment.source)}</strong></p><p>Session access ends: <time dateTime={participant.sessionEndsAt}>{explicitUtcTime(participant.sessionEndsAt)}</time></p>{durableFeedback(participant) ? <p role="status" aria-live="polite">{durableFeedback(participant)}</p> : null}<div role="group" aria-label="Participant actions" className={styles.inspectorActions}>{(["invite", "resend", "generate_launch", "revoke_launch"] as const).map((action) => { const reason = participantActionReason(participant, action, now); const reasonId = `participant-${participant.id}-${action}-reason`; return <React.Fragment key={action}><button type="button" style={primary === action ? primaryButtonStyle : secondaryButtonStyle} data-primary-action={primary === action ? "true" : undefined} disabled={Boolean(reason)} aria-describedby={reason ? reasonId : undefined} onClick={() => void onAction(participant, action)}>{action === "generate_launch" ? "Generate launch link" : action === "revoke_launch" ? "Revoke launch link" : action[0].toUpperCase() + action.slice(1)}</button>{reason ? <span id={reasonId}>{reason}</span> : null}</React.Fragment>; })}</div>{feedback ? <p role="status" aria-live="polite">{feedback}</p> : null}<p><a href={`/sales/sessions/${encodeURIComponent(sessionId)}?area=activity${participant.launchOperation?.correlationId ? `&correlationId=${encodeURIComponent(participant.launchOperation.correlationId)}` : ""}`}>View Activity</a> · <a style={primary === "open_diagnostics" ? primaryButtonStyle : undefined} data-primary-action={primary === "open_diagnostics" ? "true" : undefined} href="/sales?tab=support">Open Support</a></p></aside>;
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function textField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function explicitUtcTime(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return "Invalid time";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Invalid time" : parsed.toISOString();
}
function durableFeedback(participant: SalesParticipantWorkspaceRow): string | null { const invitationOutcome = participant.invitationOutcome ?? participant.latestInvitationOutcome; const invitationReason = participant.invitationReason ?? participant.latestInvitationReason; const invitationCorrelation = participant.invitationCorrelationId ?? participant.latestInvitationCorrelationId; const invitationLabel = invitationOutcome === "completed_with_unconfirmed" ? "completed with confirmation pending; replay fence retained" : invitationOutcome; const invitation = invitationLabel ? `Invitation action: ${invitationLabel}${invitationReason ? ` (${invitationReason})` : ""}${invitationCorrelation ? `. Correlation ${invitationCorrelation}.` : "."}` : null; const launch = participant.launchOperation ? `Launch ${participant.launchOperation.operation}: ${participant.launchOperation.outcome}${participant.launchOperation.reason ? ` (${participant.launchOperation.reason})` : ""}${participant.launchOperation.correlationId ? `. Correlation ${participant.launchOperation.correlationId}.` : "."}` : null; return [invitation, launch].filter(Boolean).join(" ") || null; }

function humanEnvironmentSource(value: string): string {
  if (value === "cloudshare_v3_environment") return "Observed from CloudShare Environment";
  if (value === "cloudshare_v4_sales_participant_roster") return "Observed from CloudShare participant roster";
  if (value === "not_assigned") return "No CloudShare Environment is assigned";
  return "CloudShare Environment state has not been observed";
}
