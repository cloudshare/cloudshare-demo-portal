"use client";

import React, { useEffect, useRef, useState } from "react";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { primaryButtonStyle } from "./button-styles";
import { cardStyle } from "./card-styles";
import type { SalesNavigationIntent, SalesSessionQueueView, SalesWorkspaceRouteState } from "./sales-shell-route";
import styles from "./sales-sessions-workbench.module.css";

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
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const view = route.queueView ?? "active";
  const sort = route.queueSort ?? "start_desc";
  const offset = route.queueOffset ?? 0;
  const search = route.queueSearch ?? "";
  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ accountPage: "1", accountPageSize: "50", page: "1", pageSize: "50" });
    if (search) { params.set("accountSearch", search); params.set("search", search); }
    if (route.accountId) params.set("accountId", route.accountId);
    if (route.opportunityId) params.set("selectedOpportunityId", route.opportunityId);
    setOptionsError(null);
    void fetchRef.current(`/api/sales/session-opportunities?${params}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load bounded Account and Opportunity filters.");
        return response.json() as Promise<SalesRecordOptions>;
      })
      .then((body) => { if (live) setRecordOptions(body); })
      .catch(() => { if (live) setOptionsError("Account and Opportunity filters could not be loaded. Existing choices remain available; retry by changing the search or reloading this page."); });
    return () => { live = false; };
  }, [route.accountId, route.opportunityId, search]);
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
  const rows = data?.rows ?? [];
  const range = data ? `${data.total ? data.offset + 1 : 0}–${Math.min(data.offset + rows.length, data.total)} of ${data.total}` : null;
  return <section aria-label="Sales Sessions workbench" style={{ ...cardStyle, padding: 0 }} className={styles.workbench}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Sales operations</p>
        <h2 className={styles.title}>Sessions</h2>
        <p className={styles.description}>Triage the Customer&apos;s scheduled and live Sales Experiences. Certalis operation, CloudShare Experience, and Participant Environment remain separate.</p>
      </div>
      <button type="button" style={primaryButtonStyle} className={styles.provisionButton} onClick={() => onNavigate({ tab: "sessions", sessionView: "provision" })}>Provision a Session</button>
    </header>

    <div className={styles.commandRail}>
      <div aria-label="Session queue views" className={styles.viewSwitcher}>{(["active", "needs_attention", "history"] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={view === candidate} className={styles.viewButton} onClick={() => navigate({ queueView: candidate, queueOffset: 0, sessionId: null })}>{candidate === "active" ? "Active" : candidate === "needs_attention" ? "Needs attention" : "History"}</button>)}</div>
      <form aria-label="Session queue filters" className={styles.filters} onSubmit={(event) => { event.preventDefault(); navigate({ queueSearch: searchDraft, queueOffset: 0, sessionId: null }); }}>
        <label className={styles.field}>Account<select className={styles.control} aria-label="Account filter" value={route.accountId ?? ""} onChange={(event) => navigate({ accountId: event.target.value || null, opportunityId: null, queueOffset: 0, sessionId: null })}><option value="">All Accounts</option>{recordOptions.accounts?.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className={styles.field}>Opportunity<select className={styles.control} aria-label="Opportunity filter" value={route.opportunityId ?? ""} onChange={(event) => navigate({ opportunityId: event.target.value || null, queueOffset: 0, sessionId: null })}><option value="">All Opportunities</option>{recordOptions.opportunities?.filter((opportunity) => !route.accountId || opportunity.accountId === route.accountId).map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label>
        <label className={styles.field}>Search<input className={styles.control} name="search" aria-label="Search Sessions" placeholder="Sessions, Accounts, or Opportunities" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
        <label className={styles.field}>Sort<select className={styles.control} aria-label="Session queue sort" value={sort} onChange={(event) => navigate({ queueSort: event.target.value as typeof sort, queueOffset: 0, sessionId: null })}><option value="start_desc">Start time, newest first</option><option value="start_asc">Start time, oldest first</option><option value="name_asc">Session name</option></select></label>
        <button type="submit" className={`${styles.pageButton} ${styles.applyButton}`}>Apply</button>
      </form>
    </div>

    {loading ? <p role="status" className={styles.feedback}>Loading the local Sessions queue…</p> : null}
    {error ? <p role="alert" className={`${styles.feedback} ${styles.feedbackError}`}>{error}</p> : null}
    {data?.target && data.target.state !== "available" ? <p role="status" className={styles.feedback}>{data.target.message}</p> : null}
    {optionsError ? <p role="alert" className={`${styles.feedback} ${styles.feedbackError}`}>{optionsError}</p> : null}

    <div className={styles.queueFrame}>
      <div className={styles.queueMeta}><strong>{view === "active" ? "Active Sessions" : view === "needs_attention" ? "Sessions needing attention" : "Session history"}</strong>{range ? <span>{range}</span> : null}</div>
      <div tabIndex={0} aria-label="Sales Sessions queue table" className={styles.tableScroller}>
        <table className={styles.table}>
          <thead><tr><th scope="col" className={styles.sessionColumn}>Session</th><th scope="col" className={styles.relationshipColumn}>Relationship</th><th scope="col" className={styles.timeColumn}>Time window</th><th scope="col" className={styles.statusColumn}>Certalis operation</th><th scope="col" className={styles.statusColumn}>CloudShare Experience</th><th scope="col" className={styles.environmentColumn}>Participant Environment</th><th scope="col" className={styles.attentionColumn}>Attention</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} data-selected={route.sessionId === row.id ? "true" : undefined}>
            <th scope="row"><button ref={route.sessionId === row.id ? selectedRef : undefined} type="button" aria-current={route.sessionId === row.id ? "true" : undefined} className={styles.sessionLink} onClick={() => navigate({ sessionId: row.id })}>{row.sessionName}</button><span className={styles.secondaryLine}>Revision {row.revision}</span></th>
            <td><span className={styles.primaryLine}>{row.accountName}</span><span className={styles.secondaryLine}>{row.opportunityName}</span></td>
            <td><span className={styles.timeLine}><span className={styles.timeLabel}>Start</span><time dateTime={row.start}>{row.start}</time></span><span className={styles.timeLine}><span className={styles.timeLabel}>End</span><time dateTime={row.end}>{row.end}</time></span><span className={styles.secondaryLine}>CloudShare time zone: {row.timeZone}</span></td>
            <td><StatusDimension label="Certalis operation" value={row.operation.value} /></td>
            <td><StatusDimension label="CloudShare Experience" value={row.experience.value} detail={row.experience.source === "cloudshare_v4_get_sales" ? `${row.experience.freshness} observation${row.experience.observedAt ? ` · ${row.experience.observedAt}` : ""}` : "Estimated from the Session schedule — not recently confirmed with CloudShare."} /></td>
            <td>{row.participantEnvironment ? <StatusDimension label="Participant Environment" value={`${row.participantEnvironment.participantName}: ${row.participantEnvironment.observation.value ?? "not observed"}`} detail={`${row.participantEnvironment.observation.source}${row.participantEnvironment.observation.observedAt ? ` · ${row.participantEnvironment.observation.observedAt}` : ""}`} neutral /> : <span className={styles.noAttention}>No participant exception</span>}</td>
            <td>{row.attention ? <div className={styles.attention}><span className={styles.attentionEntity}>{row.attention.entity}</span><span>{row.attention.dimension.replaceAll("_", " ")} — {row.attention.reason}</span></div> : <span className={styles.noAttention}>No attention required</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {data && rows.length === 0 ? <div className={styles.emptyState}><strong>No Sessions in this view</strong><span>Adjust the queue view or filters to broaden the results.</span></div> : null}
    </div>

    {data ? <footer role="status" className={styles.footer}><span>Showing {range}</span><div className={styles.pagination}><button className={styles.pageButton} type="button" disabled={offset === 0} onClick={() => navigate({ queueOffset: Math.max(0, offset - data.limit) })}>Previous page</button><button className={styles.pageButton} type="button" disabled={offset + rows.length >= data.total} onClick={() => navigate({ queueOffset: offset + data.limit })}>Next page</button></div></footer> : null}
  </section>;
}

function StatusDimension({ label, value, detail, neutral = false }: { readonly label: string; readonly value: string; readonly detail?: string; readonly neutral?: boolean }) {
  return <div className={styles.dimension}><span className={styles.dimensionLabel}>{label}</span><span className={`${styles.badge}${neutral ? ` ${styles.badgeNeutral}` : ""}`}>{formatStatus(value)}</span>{detail ? <span className={styles.secondaryLine}>{detail}</span> : null}</div>;
}

function formatStatus(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}
