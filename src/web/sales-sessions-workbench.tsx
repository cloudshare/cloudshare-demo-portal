"use client";

import React, { useEffect, useRef, useState } from "react";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { compactButtonStyle, primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { cardStyle } from "./card-styles";
import type { SalesNavigationIntent, SalesSessionQueueView, SalesWorkspaceRouteState } from "./sales-shell-route";

type QueueRow = { id: string; accountId: string; accountName: string; opportunityId: string; opportunityName: string; sessionName: string; revision: number; start: string; end: string; timeZone: string; operation: { value: string }; experience: { value: string; source: string; freshness: string; observedAt?: string }; participantEnvironment?: { participantName: string; observation: { value: string | null; source: string; observedAt?: string } }; attention?: { entity: string; dimension: string; reason: string } };
type QueueResponse = { view: SalesSessionQueueView; offset: number; limit: number; total: number; rows: QueueRow[]; target?: { id: string; state: string; message?: string } };
type SalesRecordOptions = { accounts?: { id: string; name: string }[]; opportunities?: { id: string; accountId: string; name: string }[] };

export function SalesSessionsWorkbench({ route, onNavigate }: { readonly route: SalesWorkspaceRouteState; readonly onNavigate: (intent: SalesNavigationIntent) => void }) {
  const fetchRef = useRef(createAdminAuthenticatedRequest({ fetchImpl: (input, init) => window.fetch(input, init), onSessionExpired: () => { window.location.assign("/login"); } }));
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState(route.queueSearch ?? "");
  const [recordOptions, setRecordOptions] = useState<SalesRecordOptions>({});
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const view = route.queueView ?? "active";
  const sort = route.queueSort ?? "start_desc";
  const offset = route.queueOffset ?? 0;
  const search = route.queueSearch ?? "";
  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    let live = true;
    void fetchRef.current("/api/sales/session-opportunities?offset=0&limit=100", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<SalesRecordOptions> : {})
      .then((body) => { if (live) setRecordOptions(body); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    const load = async () => {
      setLoading(true); setError(null);
      const params = new URLSearchParams({ queue: "1", view, sort, offset: String(offset), limit: "25" });
      if (search) params.set("search", search);
      if (route.accountId) params.set("accountId", route.accountId);
      if (route.opportunityId) params.set("opportunityId", route.opportunityId);
      if (route.sessionId) params.set("target", route.sessionId);
      try { const response = await fetchRef.current(`/api/sales/enablement-sessions?${params}`, { cache: "no-store" }); const body = await response.json() as QueueResponse & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Could not load the local Sales Sessions queue."); if (live) setData(body); }
      catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Could not load the local Sales Sessions queue."); }
      finally { if (live) setLoading(false); }
    };
    void load(); return () => { live = false; };
  }, [offset, route.accountId, route.opportunityId, route.sessionId, search, sort, view]);
  useEffect(() => {
    if (data?.target?.state === "available" && selectedRef.current) {
      selectedRef.current.focus({ preventScroll: true });
      selectedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [data?.target?.state, route.sessionId]);
  const navigate = (changes: Partial<SalesNavigationIntent>) => onNavigate({ tab: "sessions", sessionView: "manage", queueView: view, queueSearch: search, queueSort: sort, queueOffset: offset, accountId: route.accountId, opportunityId: route.opportunityId, ...changes, preserveScroll: true });
  return <section aria-label="Sales Sessions workbench" style={{ ...cardStyle, padding: "1.25rem", display: "grid", gap: "1rem", minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}><div><h2 style={{ margin: 0 }}>Sessions</h2><p style={{ margin: "0.35rem 0 0" }}>Local, Customer-scoped operational queue. Provider state is shown separately from Certalis operation.</p></div><button type="button" style={primaryButtonStyle} onClick={() => onNavigate({ tab: "sessions", sessionView: "provision" })}>Provision a Session</button></div>
    <div aria-label="Session queue views" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>{(["active", "needs_attention", "history"] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={view === candidate} style={view === candidate ? primaryButtonStyle : secondaryButtonStyle} onClick={() => navigate({ queueView: candidate, queueOffset: 0, sessionId: null })}>{candidate === "active" ? "Active" : candidate === "needs_attention" ? "Needs attention" : "History"}</button>)}</div>
    <form onSubmit={(event) => { event.preventDefault(); navigate({ queueSearch: searchDraft, queueOffset: 0, sessionId: null }); }} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
      <label>Account <select aria-label="Account filter" value={route.accountId ?? ""} onChange={(event) => navigate({ accountId: event.target.value || null, opportunityId: null, queueOffset: 0, sessionId: null })}><option value="">All Accounts</option>{recordOptions.accounts?.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <label>Opportunity <select aria-label="Opportunity filter" value={route.opportunityId ?? ""} onChange={(event) => navigate({ opportunityId: event.target.value || null, queueOffset: 0, sessionId: null })}><option value="">All Opportunities</option>{recordOptions.opportunities?.filter((opportunity) => !route.accountId || opportunity.accountId === route.accountId).map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label>
      <label>Search Sessions, Accounts, or Opportunities <input name="search" aria-label="Search Sessions" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
      <label>Sort <select aria-label="Session queue sort" value={sort} onChange={(event) => navigate({ queueSort: event.target.value as typeof sort, queueOffset: 0, sessionId: null })}><option value="start_desc">Start time, newest first</option><option value="start_asc">Start time, oldest first</option><option value="name_asc">Session name</option></select></label><button type="submit" style={secondaryButtonStyle}>Apply</button>
    </form>
    {loading ? <p role="status">Loading the local Sessions queue…</p> : null}{error ? <p role="alert">{error}</p> : null}{data?.target && data.target.state !== "available" ? <p role="status">{data.target.message}</p> : null}
    <div tabIndex={0} aria-label="Sales Sessions queue table" style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: "56rem", borderCollapse: "collapse" }}><thead><tr><th scope="col">Session</th><th scope="col">Account / Opportunity</th><th scope="col">Time window</th><th scope="col">Certalis operation</th><th scope="col">CloudShare Experience</th><th scope="col">Participant Environment</th><th scope="col">Attention</th></tr></thead><tbody>{(data?.rows ?? []).map((row) => <tr key={row.id} style={route.sessionId === row.id ? { outline: "3px solid #0f6d66", outlineOffset: "-3px" } : undefined}><th scope="row"><button ref={route.sessionId === row.id ? selectedRef : undefined} type="button" aria-current={route.sessionId === row.id ? "true" : undefined} style={compactButtonStyle} onClick={() => navigate({ sessionId: row.id })}>{row.sessionName}</button><br /><small>Revision {row.revision}</small></th><td>{row.accountName}<br /><small>{row.opportunityName}</small></td><td><time dateTime={row.start}>{row.start}</time> to <time dateTime={row.end}>{row.end}</time><br /><small>CloudShare time zone: {row.timeZone}</small></td><td>{row.operation.value}</td><td>{row.experience.value}<br /><small>{row.experience.source === "cloudshare_v4_get_sales" ? `${row.experience.freshness} observation${row.experience.observedAt ? ` · ${row.experience.observedAt}` : ""}` : "Estimated from the Session schedule — not recently confirmed with CloudShare."}</small></td><td>{row.participantEnvironment ? <>{row.participantEnvironment.participantName}: {row.participantEnvironment.observation.value ?? "not observed"}<br /><small>{row.participantEnvironment.observation.source}{row.participantEnvironment.observation.observedAt ? ` · ${row.participantEnvironment.observation.observedAt}` : ""}</small></> : "—"}</td><td>{row.attention ? <>{row.attention.entity}: {row.attention.dimension.replaceAll("_", " ")} — {row.attention.reason}</> : "—"}</td></tr>)}</tbody></table></div>
    {data && data.rows.length === 0 ? <p>No Sessions match this queue view.</p> : null}{data ? <div role="status" style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}><span>Showing {data.total ? data.offset + 1 : 0}–{Math.min(data.offset + data.rows.length, data.total)} of {data.total}</span><button type="button" disabled={offset === 0} onClick={() => navigate({ queueOffset: Math.max(0, offset - data.limit) })}>Previous page</button><button type="button" disabled={offset + data.rows.length >= data.total} onClick={() => navigate({ queueOffset: offset + data.limit })}>Next page</button></div> : null}
  </section>;
}
