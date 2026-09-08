"use client";

import React, { useEffect, useRef, useState } from "react";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { primaryButtonStyle } from "./button-styles";
import { cardStyle } from "./card-styles";
import { buildSalesWorkspaceHref, salesQueueScrollStorageKey, type SalesNavigationIntent, type SalesSessionQueueView, type SalesWorkspaceRouteState } from "./sales-shell-route";
import styles from "./sales-sessions-workbench.module.css";
import { getExpiredPortalLoginPath } from "../auth/portal-return-target";

type QueueRow = { id: string; accountId: string; accountName: string; opportunityId: string; opportunityName: string; sessionName: string; revision: number; start: string; end: string; timeZone: string; operation: { value: string; source: string }; experience: { value: string; source: string; freshness: string; observedAt?: string }; participantEnvironment?: { participantName: string; observation: { value: string | null; source: string; observedAt?: string } }; attention?: { entity: string; dimension: string; reason: string } };
type QueueResponse = { view: SalesSessionQueueView; offset: number; limit: number; total: number; rows: QueueRow[]; target?: { id: string; state: string; message?: string } };
type QueueRequestState = { view: SalesSessionQueueView; sort: NonNullable<SalesWorkspaceRouteState["queueSort"]>; offset: number; search: string; accountId?: string; opportunityId?: string; sessionId?: string };
type SuccessfulQueueResult = { response: QueueResponse; request: QueueRequestState };
type SalesRecordOptions = { accounts?: { id: string; name: string }[]; opportunities?: { id: string; accountId: string; name: string }[] };
const queueViewPresentation: Record<SalesSessionQueueView, { readonly button: string; readonly heading: string }> = {
  active: { button: "Active", heading: "Active Sessions" },
  needs_attention: { button: "Needs attention", heading: "Sessions needing attention" },
  history: { button: "History", heading: "Session history" },
};

export function SalesSessionsWorkbench({ route, creationNotice, onNavigate, onSessionExpired = () => { window.location.replace(getExpiredPortalLoginPath(`${window.location.pathname}${window.location.search}`) ?? "/login"); } }: { readonly route: SalesWorkspaceRouteState; readonly creationNotice?: SalesNavigationIntent["creationNotice"]; readonly onNavigate: (intent: SalesNavigationIntent) => void; readonly onSessionExpired?: () => void }) {
  const fetchRef = useRef(createAdminAuthenticatedRequest({ fetchImpl: (input, init) => window.fetch(input, init), onSessionExpired }));
  const [result, setResult] = useState<SuccessfulQueueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState(route.queueSearch ?? "");
  const [recordOptions, setRecordOptions] = useState<SalesRecordOptions>({});
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [queueReload, setQueueReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null);
  const selectedRef = useRef<HTMLAnchorElement | null>(null);
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
      const requestState: QueueRequestState = { view, sort, offset, search, ...(route.accountId ? { accountId: route.accountId } : {}), ...(route.opportunityId ? { opportunityId: route.opportunityId } : {}), ...(route.sessionId ? { sessionId: route.sessionId } : {}) };
      try { const response = await fetchRef.current(`/api/sales/enablement-sessions?${params}`, { cache: "no-store" }); const body = await response.json() as QueueResponse & { error?: string }; if (!response.ok) throw new Error(body.error ?? "Could not load the local Sales Sessions queue."); if (live) setResult({ response: body, request: requestState }); }
      catch (cause) { if (live) setError(cause instanceof Error ? cause.message : "Could not load the local Sales Sessions queue."); }
      finally { if (live) setLoading(false); }
    };
    void load(); return () => { live = false; };
  }, [offset, queueReload, route.accountId, route.opportunityId, route.sessionId, search, sort, view]);
  useEffect(() => {
    if (result?.response.target?.state === "available" && selectedRef.current) {
      selectedRef.current.focus({ preventScroll: true });
      selectedRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [result?.response.target?.state, route.sessionId]);
  useEffect(() => {
    if (result?.response.target?.state !== "available" || !route.sessionId) return;
    const queueHref = buildSalesWorkspaceHref({ tab: "sessions", sessionView: "manage", sessionId: route.sessionId, queueView: view, queueSearch: search, queueSort: sort, queueOffset: offset, accountId: route.accountId, opportunityId: route.opportunityId });
    const key = salesQueueScrollStorageKey(queueHref);
    const saved = window.sessionStorage.getItem(key);
    if (!saved) return;
    window.sessionStorage.removeItem(key);
    const position = Number(saved);
    if (Number.isFinite(position) && position >= 0) window.scrollTo(0, position);
  }, [result?.response.target?.state, route.accountId, route.opportunityId, route.queueSearch, route.queueSort, route.queueView, route.sessionId, search, sort, offset, view]);
  const navigate = (changes: Partial<SalesNavigationIntent>) => onNavigate({ tab: "sessions", sessionView: "manage", queueView: view, queueSearch: search, queueSort: sort, queueOffset: offset, accountId: route.accountId, opportunityId: route.opportunityId, ...changes, preserveScroll: true });
  const selectedQueueHref = (sessionId: string) => buildSalesWorkspaceHref({ tab: "sessions", sessionView: "manage", sessionId, queueView: view, queueSearch: search, queueSort: sort, queueOffset: offset, accountId: route.accountId, opportunityId: route.opportunityId });
  const workspaceHref = (sessionId: string) => `/sales/sessions/${encodeURIComponent(sessionId)}?from=${encodeURIComponent(selectedQueueHref(sessionId))}`;
  const rememberOpenedSession = (event: React.MouseEvent<HTMLAnchorElement>, sessionId: string) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.currentTarget.target && event.currentTarget.target !== "_self")) return;
    const queueHref = selectedQueueHref(sessionId);
    window.sessionStorage.setItem(salesQueueScrollStorageKey(queueHref), String(window.scrollY));
    window.history.replaceState(window.history.state, "", queueHref);
  };
  const data = result?.response ?? null;
  const refreshCloudShare = async () => {
    setRefreshing(true); setRefreshFeedback("Refreshing Sales Session status from CloudShare…");
    try { const response = await fetchRef.current(`/api/sales/enablement-sessions/refresh?mode=manual&offset=${offset}&limit=25`, { method: "POST" }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "CloudShare refresh failed."); setRefreshFeedback("Sales Session status refreshed."); setQueueReload((value) => value + 1); } catch (cause) { setRefreshFeedback(cause instanceof Error ? `${cause.message} Retry or open Sales support.` : "CloudShare refresh failed. Retry or open Sales support."); } finally { setRefreshing(false); }
  };
  const displayedRequest = result?.request;
  const rows = data?.rows ?? [];
  const range = data ? `${data.total ? data.offset + 1 : 0}–${Math.min(data.offset + rows.length, data.total)} of ${data.total}` : null;
  return <section aria-label="Sales Sessions workbench" style={{ ...cardStyle, padding: 0 }} className={styles.workbench}>
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Sales operations</p>
        <h2 className={styles.title}>Sessions</h2>
        <p className={styles.description}>Triage the Customer&apos;s scheduled and live Sales Experiences. Certalis operation, CloudShare Experience, and Participant Environment remain separate.</p>
      </div>
      <button type="button" style={primaryButtonStyle} className={styles.provisionButton} onClick={() => onNavigate({ tab: "sessions", sessionView: "provision" })}>Provision a Session</button><button type="button" className={styles.pageButton} onClick={() => void refreshCloudShare()} disabled={refreshing} aria-busy={refreshing}>{refreshing ? "Refreshing…" : "Refresh CloudShare status"}</button>
    </header>

    <section className={styles.commandRail} aria-label="Session queue controls">
      <div className={styles.commandRailHeading}>Session queue</div>
      <div aria-label="Session queue views" className={styles.viewSwitcher}>{(["active", "needs_attention", "history"] as const).map((candidate) => <button key={candidate} type="button" aria-pressed={view === candidate} className={styles.viewButton} onClick={() => navigate({ queueView: candidate, queueOffset: 0, sessionId: null })}>{queueViewPresentation[candidate].button}</button>)}</div>
      <form aria-label="Session queue filters" className={styles.filters} onSubmit={(event) => { event.preventDefault(); navigate({ queueSearch: searchDraft, queueOffset: 0, sessionId: null }); }}>
        <label className={styles.field}>Account<select className={styles.control} aria-label="Account filter" value={route.accountId ?? ""} onChange={(event) => navigate({ accountId: event.target.value || null, opportunityId: null, queueOffset: 0, sessionId: null })}><option value="">All Accounts</option>{recordOptions.accounts?.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label className={styles.field}>Opportunity<select className={styles.control} aria-label="Opportunity filter" value={route.opportunityId ?? ""} onChange={(event) => navigate({ opportunityId: event.target.value || null, queueOffset: 0, sessionId: null })}><option value="">All Opportunities</option>{recordOptions.opportunities?.filter((opportunity) => !route.accountId || opportunity.accountId === route.accountId).map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label>
        <label className={styles.field}>Search<input className={styles.control} name="search" aria-label="Search Sessions" placeholder="Sessions, Accounts, or Opportunities" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
        <label className={styles.field}>Sort<select className={styles.control} aria-label="Session queue sort" value={sort} onChange={(event) => navigate({ queueSort: event.target.value as typeof sort, queueOffset: 0, sessionId: null })}><option value="start_desc">Start time, newest first</option><option value="start_asc">Start time, oldest first</option><option value="name_asc">Session name</option></select></label>
        <button type="submit" className={`${styles.pageButton} ${styles.applyButton}`}>Apply</button>
      </form>
    </section>

    {creationNotice ? <div role="alert" className={`${styles.feedback} ${styles.feedbackError}`}><p>{creationNotice.message} <strong>Do not retry creation.</strong></p>{creationNotice.correlationId ? <button type="button" className={styles.pageButton} onClick={() => onNavigate({ tab: "support", correlationId: creationNotice.correlationId })}>Open support diagnostics ({creationNotice.correlationId})</button> : null}</div> : null}
    {refreshFeedback ? <div role="status" className={styles.feedback}><p>{refreshFeedback}</p>{refreshFeedback.includes("Retry") ? <div className={styles.failureActions}><button type="button" className={styles.pageButton} onClick={() => void refreshCloudShare()}>Retry refresh</button><button type="button" className={styles.pageButton} onClick={() => onNavigate({ tab: "support" })}>Open Sales support</button></div> : null}</div> : null}{error ? <div role="alert" className={`${styles.feedback} ${styles.feedbackError}`}><p>{error} The last successfully loaded queue remains visible.</p><div className={styles.failureActions}><button type="button" className={styles.pageButton} onClick={() => setQueueReload((value) => value + 1)}>Retry queue</button><button type="button" className={styles.pageButton} onClick={() => onNavigate({ tab: "support" })}>Open Sales support</button></div></div> : null}
    {data?.target && data.target.state !== "available" ? <p role="status" className={styles.feedback}>{data.target.message}</p> : null}
    {optionsError ? <p role="alert" className={`${styles.feedback} ${styles.feedbackError}`}>{optionsError}</p> : null}

    <div className={styles.queueFrame}>
      <div className={styles.queueMeta}><strong id="sales-sessions-result-heading">{queueViewPresentation[displayedRequest?.view ?? view].heading}</strong><span>{loading ? <span role="status" aria-label={`${queueViewPresentation[view].button} queue loading status`} className={styles.inlineLoading}>Loading the local Sessions queue…</span> : null}{range ? <span>{range}</span> : null}</span></div>
      <div role="region" aria-labelledby="sales-sessions-result-heading" aria-busy={loading}>
        <div tabIndex={0} aria-label="Sales Sessions queue table" className={styles.tableScroller}>
        <table className={styles.table}>
          <thead><tr><th scope="col" className={styles.sessionColumn}>Session</th><th scope="col" className={styles.relationshipColumn}>Relationship</th><th scope="col" className={styles.timeColumn}>Time window</th><th scope="col" className={styles.statusColumn}>Certalis operation</th><th scope="col" className={styles.statusColumn}>CloudShare Experience</th><th scope="col" className={styles.environmentColumn}>Participant Environment</th><th scope="col" className={styles.attentionColumn}>Attention</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} data-selected={route.sessionId === row.id ? "true" : undefined}>
            <th scope="row"><a ref={route.sessionId === row.id ? selectedRef : undefined} aria-current={route.sessionId === row.id ? "true" : undefined} className={styles.sessionLink} href={workspaceHref(row.id)} onClick={(event) => rememberOpenedSession(event, row.id)}>{row.sessionName}</a><span className={styles.secondaryLine}>Revision {row.revision}</span></th>
            <td><span className={styles.primaryLine}>{row.accountName}</span><span className={styles.secondaryLine}>{row.opportunityName}</span></td>
            <td><span className={styles.timeLine}><span className={styles.timeLabel}>Start</span><time dateTime={row.start}>{row.start}</time></span><span className={styles.timeLine}><span className={styles.timeLabel}>End</span><time dateTime={row.end}>{row.end}</time></span><span className={styles.secondaryLine}>CloudShare time zone: {row.timeZone}</span></td>
            <td><StatusDimension label="Certalis operation" value={row.operation.value} detail={row.operation.source === "certalis_persistence" ? "Recorded by Certalis persistence." : `Certalis source: ${formatStatus(row.operation.source)}.`} /></td>
            <td><StatusDimension label="CloudShare Experience" value={row.experience.value} detail={row.experience.source === "cloudshare_v4_get_sales" ? `Observed from CloudShare · ${formatStatus(row.experience.freshness)}${row.experience.observedAt ? ` · ${row.experience.observedAt}` : ""}` : "Estimated from the Session schedule — not recently confirmed with CloudShare."} /></td>
            <td>{row.participantEnvironment ? <StatusDimension label="Participant Environment" {...participantEnvironmentPresentation(row.participantEnvironment)} neutral /> : <span className={styles.noAttention}>No Participant Environment observation available</span>}</td>
            <td>{row.attention ? <div className={styles.attention}><span className={styles.attentionEntity}>{row.attention.entity}</span><span>{row.attention.dimension.replaceAll("_", " ")} — {row.attention.reason}</span></div> : <span className={styles.noAttention}>No attention required</span>}</td>
          </tr>)}</tbody>
        </table>
        </div>
        {data && rows.length === 0 ? <div className={styles.emptyState}><strong>No Sessions in this view</strong><span>Adjust the queue view or filters to broaden the results.</span></div> : null}
      </div>
    </div>

    {data ? <footer role="status" className={styles.footer}><span>Showing {range}</span><div className={styles.pagination}><button className={styles.pageButton} type="button" disabled={(displayedRequest?.offset ?? data.offset) === 0} onClick={() => navigate({ queueView: displayedRequest?.view ?? view, queueOffset: Math.max(0, (displayedRequest?.offset ?? data.offset) - data.limit) })}>Previous page</button><button className={styles.pageButton} type="button" disabled={(displayedRequest?.offset ?? data.offset) + rows.length >= data.total} onClick={() => navigate({ queueView: displayedRequest?.view ?? view, queueOffset: (displayedRequest?.offset ?? data.offset) + data.limit })}>Next page</button></div></footer> : null}
  </section>;
}

function StatusDimension({ label, value, detail, neutral = false }: { readonly label: string; readonly value: string; readonly detail?: string; readonly neutral?: boolean }) {
  return <div className={styles.dimension}><span className={styles.dimensionLabel}>{label}</span><span className={`${styles.badge}${neutral ? ` ${styles.badgeNeutral}` : ""}`}>{formatStatus(value)}</span>{detail ? <span className={styles.secondaryLine}>{detail}</span> : null}</div>;
}

function formatStatus(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}

function participantEnvironmentPresentation(environment: NonNullable<QueueRow["participantEnvironment"]>): { readonly value: string; readonly detail: string } {
  const { observation, participantName } = environment;
  if (observation.source === "not_assigned") return { value: `${participantName}: Not assigned`, detail: "No CloudShare Environment is assigned." };
  if (observation.source === "not_observed") return { value: `${participantName}: Not observed`, detail: "CloudShare Environment state has not been observed." };
  const surface = observation.source === "cloudshare_v3_environment" ? "CloudShare Environment" : "CloudShare participant roster";
  return { value: `${participantName}: ${observation.value ?? "Not observed"}`, detail: `Observed from ${surface}${observation.observedAt ? ` · ${observation.observedAt}` : ""}` };
}
