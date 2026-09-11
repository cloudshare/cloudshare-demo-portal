"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";
import { useContext } from "react";
import { SalesWorkspaceExpiryContext } from "./sales-workspace-chrome";
import { statusBadgeStyle } from "./status-badge";
import styles from "./sales-session-workspace.module.css";
import type { SalesSessionWorkspaceResponse } from "@/domain/sales-session-workspace";
import type { SalesSessionVerifyResponse } from "@/api/sales-session-reconciliation";

type Area = "participants" | "activity" | "details";
type DiagnosticRecord = { readonly correlationId: string; readonly occurredAt: string };

export function SalesSessionWorkspace(props: { readonly sessionId: string; readonly area: Area; readonly queueHref: string }) {
  return <SalesSessionWorkspaceState key={props.sessionId} {...props} />;
}

function SalesSessionWorkspaceState({ sessionId, area, queueHref }: { readonly sessionId: string; readonly area: Area; readonly queueHref: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<SalesSessionWorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [verification, setVerification] = useState<string | null>(null);
  const [verificationCorrelationId, setVerificationCorrelationId] = useState<string | null>(null);
  const [refreshCorrelationId, setRefreshCorrelationId] = useState<string | null>(null);
  const attemptedRefresh = useRef<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [automaticRefresh, setAutomaticRefresh] = useState<string | null>(null);
  const [refreshOutcome, setRefreshOutcome] = useState<"idle" | "pending" | "success" | "failure">("idle");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const requestInFlight = useRef(false);
  const lifecycle = useRef({ active: false, token: 0 });
  const shellExpiry = useContext(SalesWorkspaceExpiryContext);
  const areaHeading = useRef<HTMLHeadingElement>(null);
  const handleSessionExpired = useMemo(() => shellExpiry ?? createPortalSessionExpiryRedirect({ currentPath: () => `${window.location.pathname}${window.location.search}`, fallbackLoginPath: "/login", replace: (path) => { if (lifecycle.current.active) { setSessionExpired(true); router.replace(path); } } }), [router, shellExpiry]);
  useEffect(() => {
    const owner = lifecycle.current;
    owner.active = true;
    owner.token += 1;
    return () => { owner.active = false; };
  }, []);
  useEffect(() => {
    const token = ++lifecycle.current.token;
    requestInFlight.current = false;
    const request = createAdminAuthenticatedRequest({ fetchImpl: window.fetch.bind(window), onSessionExpired: handleSessionExpired });
    void request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/workspace`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as SalesSessionWorkspaceResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The Sales Session could not be loaded.");
      if (lifecycle.current.active && lifecycle.current.token === token) setWorkspace(body);
    }).catch((cause) => { if (lifecycle.current.active && lifecycle.current.token === token) setError(cause instanceof Error ? cause.message : "The Sales Session could not be loaded."); });
  }, [handleSessionExpired, sessionId]);
  useEffect(() => {
    if (area === "activity" || !workspace || workspace.summary.experience.freshness === "fresh" || requestInFlight.current) return;
    const snapshot = `${workspace.summary.id}:${workspace.summary.experience.source}:${workspace.summary.experience.freshness}:${workspace.summary.experience.observedAt ?? ""}`;
    if (attemptedRefresh.current === snapshot) return;
    attemptedRefresh.current = snapshot;
    const token = lifecycle.current.token;
    requestInFlight.current = true; setRefreshBusy(true); setRefreshOutcome("pending"); setAutomaticRefresh("Checking the latest CloudShare status…");
    const request = createAdminAuthenticatedRequest({ fetchImpl: window.fetch.bind(window), onSessionExpired: handleSessionExpired });
    void request(`/api/sales/enablement-sessions/refresh?mode=automatic&targetId=${encodeURIComponent(sessionId)}&limit=1`, { method: "POST" }).then(async (response) => {
      const body = await response.json() as { error?: string; correlationId?: string };
      if (!response.ok) { if (body.correlationId && lifecycle.current.active && lifecycle.current.token === token) setRefreshCorrelationId(body.correlationId); throw new Error(body.error ?? "Automatic refresh failed. Retry or open Sales support."); }
      const reread = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/workspace`, { cache: "no-store" });
      const next = await reread.json() as SalesSessionWorkspaceResponse & { error?: string };
      if (!reread.ok) throw new Error(next.error ?? "The refreshed Sales Session could not be read.");
      if (lifecycle.current.active && lifecycle.current.token === token) { setWorkspace(next); if (next.summary.experience.freshness !== "fresh") { setRefreshOutcome("failure"); setAutomaticRefresh("CloudShare returned no fresh observation. Retry or open Sales support."); } else { setRefreshOutcome("success"); setAutomaticRefresh("CloudShare status refreshed."); } }
    }).catch((cause) => { if (lifecycle.current.active && lifecycle.current.token === token) { setRefreshOutcome("failure"); setAutomaticRefresh(cause instanceof Error ? cause.message : "Automatic refresh failed. Retry or open Sales support."); } }).finally(() => { if (lifecycle.current.active && lifecycle.current.token === token) { requestInFlight.current = false; setRefreshBusy(false); } });
  }, [area, handleSessionExpired, sessionId, workspace]);
  useEffect(() => { areaHeading.current?.focus(); }, [area, workspace?.summary.id]);
  const activity = (workspace?.activityGroups ?? []).map((group) => ({ ...group, steps: group.steps ?? [] }));
  const retryAutomaticRefresh = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true; const token = lifecycle.current.token; setRefreshCorrelationId(null); setRefreshBusy(true); setRefreshOutcome("pending"); setAutomaticRefresh("Retrying CloudShare status…");
    const request = createAdminAuthenticatedRequest({ fetchImpl: window.fetch.bind(window), onSessionExpired: handleSessionExpired });
    try {
      const response = await request(`/api/sales/enablement-sessions/refresh?mode=automatic&targetId=${encodeURIComponent(sessionId)}&limit=1`, { method: "POST" });
      const body = await response.json() as { error?: string; correlationId?: string };
      if (body.correlationId && lifecycle.current.active && lifecycle.current.token === token) setRefreshCorrelationId(body.correlationId);
      if (!response.ok) throw new Error(body.error ?? "Automatic refresh failed. Retry or open Sales support.");
      const reread = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/workspace`, { cache: "no-store" });
      const next = await reread.json() as SalesSessionWorkspaceResponse & { error?: string };
      if (!reread.ok) throw new Error(next.error ?? "The refreshed Sales Session could not be read.");
      if (lifecycle.current.active && lifecycle.current.token === token) { setWorkspace(next); if (next.summary.experience.freshness !== "fresh") { setRefreshOutcome("failure"); setAutomaticRefresh("CloudShare returned no fresh observation."); } else { setRefreshOutcome("success"); setAutomaticRefresh("CloudShare status refreshed."); } }
    } catch (cause) { if (lifecycle.current.active && lifecycle.current.token === token) { setRefreshOutcome("failure"); setAutomaticRefresh(cause instanceof Error ? cause.message : "Automatic refresh failed. Retry or open Sales support."); } }
    finally { if (lifecycle.current.active && lifecycle.current.token === token) { requestInFlight.current = false; setRefreshBusy(false); } }
  };
  if (sessionExpired) return <main aria-live="polite"><p>Your session has expired. Sign in again to continue.</p></main>;
  if (error) return <section role="alert" className={styles.error}><h1>Sales Session unavailable</h1><p>{error}</p><a href={queueHref}>Back to Sessions</a></section>;
  if (!workspace) return <section aria-busy="true" aria-label="Sales Session workspace loading" className={styles.loading}>Loading Sales Session…</section>;
  const areaHref = (next: Area) => `/sales/sessions/${encodeURIComponent(sessionId)}?area=${next}&from=${encodeURIComponent(queueHref)}`;
  const queueIsHistory = new URLSearchParams(queueHref.split("?")[1] ?? "").get("queue") === "history";
  const verifyNow = async () => { if (requestInFlight.current) return; requestInFlight.current = true; const token = lifecycle.current.token; const request = createAdminAuthenticatedRequest({ fetchImpl: window.fetch.bind(window), onSessionExpired: handleSessionExpired }); setVerifying(true); setVerificationCorrelationId(null); setVerification("Verifying this Sales Session with CloudShare…"); try { const response = await request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/verify`, { method: "POST" }); const body = await response.json() as SalesSessionVerifyResponse & { error?: string }; if (!lifecycle.current.active || lifecycle.current.token !== token) return; setVerificationCorrelationId(typeof body.correlationId === "string" ? body.correlationId : null); if (!response.ok) { throw new Error(body.error ?? "Verification failed. Retry or open Sales support."); } if (body.source !== "cloudshare_v4_get_sales" || !body.correlationId || !body.observedAt || !["notStarted", "inProgress", "ended"].includes(body.experienceStatus) || body.freshness !== "fresh") throw new Error("CloudShare returned an incomplete verification observation. Retry or open Sales support."); setWorkspace((current) => current ? { ...current, summary: { ...current.summary, experience: { value: body.experienceStatus, source: body.source, freshness: body.freshness, observedAt: body.observedAt } } } : current); setVerification(`Verified from CloudShare: ${body.experienceStatus} at ${body.observedAt}. Correlation ${body.correlationId}.`); router.refresh(); } catch (cause) { if (lifecycle.current.active && lifecycle.current.token === token) setVerification(cause instanceof Error ? `${cause.message} Retry or open Sales support.` : "Verification failed. Retry or open Sales support."); } finally { if (lifecycle.current.active && lifecycle.current.token === token) { setVerifying(false); requestInFlight.current = false; } } };
  const activityHistory = workspace.activityHistory ?? { complete: true, hasMore: false };
  return <section aria-label="Sales Session workspace" className={styles.workspace}>
    <header className={styles.summary}>
      <div className={styles.summaryTopline}><div className={styles.contextTrail}><a aria-label="Back to Sessions" href={queueHref}><span aria-hidden="true">← </span>Sessions</a><span aria-hidden="true"> / </span><span>{queueIsHistory ? "History" : "Session"}</span><span aria-hidden="true"> / </span><span aria-current="page">{workspace.summary.sessionName}</span></div><span>Revision {workspace.summary.revision}</span></div>
      <div className={styles.summaryTitle}><div><p className={styles.eyebrow}>Sales Enablement Session</p><h1>{workspace.summary.sessionName}</h1></div><span className={styles.statusBadge} style={statusBadgeStyle(operationPresentation(workspace.summary.operation.value).tone)}>{operationPresentation(workspace.summary.operation.value).label}</span><button type="button" className={styles.areaTab} onClick={() => void verifyNow()} disabled={verifying || refreshBusy}>{verifying ? "Verifying…" : "Verify now"}</button></div>{automaticRefresh ? <p aria-live="polite">{automaticRefresh} {refreshOutcome === "failure" ? <><button type="button" onClick={() => void retryAutomaticRefresh()}>Retry</button>{refreshCorrelationId ? <a href={`/sales?tab=support&correlationId=${encodeURIComponent(refreshCorrelationId)}`}>Open Sales support</a> : <a href="/sales?tab=support">Open Sales support</a>}</> : null}</p> : null}{verification ? <div role="status"><p>{verification}</p>{verificationCorrelationId ? <a href={`/sales?tab=support&correlationId=${encodeURIComponent(verificationCorrelationId)}`}>Open Sales support</a> : null}</div> : null}
      <dl className={styles.summaryMetrics}>
        <SummaryMetric label="Time window"><time dateTime={workspace.summary.start}>{workspace.summary.start}</time><span> · {workspace.summary.timeZone}</span><time dateTime={workspace.summary.end}>{workspace.summary.end}</time></SummaryMetric>
        <SummaryMetric label="Certalis operation"><strong>{operationPresentation(workspace.summary.operation.value).label}</strong><span>{workspace.summary.operation.value === "needs_attention" ? workspace.summary.operation.reason : "Recorded by Certalis."}</span></SummaryMetric>
        <SummaryMetric label="CloudShare Experience"><strong>{humanExperience(workspace.summary.experience.value)}</strong><span>{workspace.summary.experience.freshness === "fresh" ? "Recently observed from CloudShare." : "Schedule estimate; not recently confirmed with CloudShare."}</span></SummaryMetric>
        <SummaryMetric label="Configuration"><strong>{workspace.details.itemName}</strong><span>{workspace.details.invitationMode}</span></SummaryMetric>
      </dl>
    </header>
    <nav aria-label="Session workspace areas" className={styles.areaNav}><span className={styles.areaNavLabel}>Session workspace</span><div className={styles.areaTabs}>{(["participants", "activity", "details"] as const).map((candidate) => <a key={candidate} className={area === candidate ? styles.areaTabActive : styles.areaTab} href={areaHref(candidate)} aria-current={area === candidate ? "page" : undefined}>{candidate[0].toUpperCase() + candidate.slice(1)}</a>)}</div></nav>
    {area === "participants" ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2 ref={areaHeading} tabIndex={-1}>Participants</h2><p>Read-only roster preview for this Sales Session.</p></div><span className={styles.count}>{workspace.participants.length} {workspace.participants.length === 1 ? "participant" : "participants"}</span></div>{workspace.participants.length ? <div className={styles.tableWrap}><table aria-label="Participant roster preview" className={styles.roster}><thead><tr><th>Participant</th><th>Invitation</th><th>Participation</th><th>Participant Environment</th><th>Environment source</th></tr></thead><tbody>{workspace.participants.map((participant) => <tr key={participant.id}><th scope="row"><strong>{participant.name}</strong><span>{participant.email}</span></th><td><span className={styles.inlineBadge}>{humanInvitation(participant.invitationStatus)}</span></td><td><span className={styles.inlineBadge}>{humanParticipation(participant.participationStatus)}</span></td><td><span className={styles.srOnly}>Participant Environment: </span>{participant.environment.value ?? "Not observed"}{"observedAt" in participant.environment ? <span className={styles.muted}>{participant.environment.observedAt}</span> : null}{participant.environmentAttention ? <span className={styles.environmentAttention}><strong>Needs attention</strong>{participant.environmentAttention.reason}</span> : null}</td><td>{humanEnvironmentSource(participant.environment.source)}{participant.environmentAttention ? <span className={styles.muted}>Attention source: {participant.environmentAttention.source}</span> : null}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No persisted Participants are registered for this Sales Session.</p>}<p className={styles.previewNote}>Detailed participant management follows in a later workspace. This preview has no participant actions or drill-downs.</p></section> : null}
    {area === "activity" ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2 ref={areaHeading} tabIndex={-1}>Activity</h2><p>Grouped operational history for this Sales Session.</p></div></div><p className={styles.activityExplainer}>Activity shows ordinary operational metadata only. Open Support Diagnostics for authorized Customer-scoped evidence when a support investigation is available.</p>{activityHistory.complete ? null : <p role="status">Activity history is incomplete; some older records are not shown.</p>}{activity.length ? <ol aria-label="Sales Session activity timeline" className={styles.timeline}>{activity.map((entry) => <li key={entry.workflowId} className={styles.timelineItem}><span className={entry.outcome === "failure" ? styles.failureDot : entry.outcome === "success" ? styles.successDot : styles.warningDot} aria-hidden="true" /><div className={styles.timelineBody}><div className={styles.timelineTitle}><strong>{entry.summary}</strong><span className={entry.outcome === "failure" ? styles.failureBadge : entry.outcome === "success" ? styles.successBadge : styles.inlineBadge}>{entry.outcome === "failure" ? "Failed" : entry.outcome === "mixed" ? "Mixed evidence" : entry.outcome === "incomplete" ? "Incomplete" : "Completed"}</span></div><div className={styles.timelineMeta}><span>{entry.count === 1 ? "1 workflow step" : `${entry.count} workflow steps`}</span><ActivityTimeRange firstAt={entry.firstAt} lastAt={entry.lastAt} /><span>Actor: {entry.actor}</span><span>Subject: {entry.subject}</span></div><ol aria-label={`${entry.summary} steps`} className={styles.stepList}>{entry.steps.map((step, index) => <li key={`${step.occurredAt}-${index}`}><span>{step.label}</span><span>{step.outcome === "failure" ? "Failed" : step.outcome === "incomplete" ? "Incomplete" : "Completed"}</span><time dateTime={step.occurredAt}>{step.occurredAt}</time></li>)}</ol><div className={styles.correlationThreads}>{entry.correlationId ? <a href={`/sales?tab=support&correlationId=${encodeURIComponent(entry.correlationId)}`}>Open Sales support investigation</a> : <a href="/sales?tab=support">Open Sales support</a>}</div></div></li>)}</ol> : <p className={styles.empty}>No safe Activity has been recorded for this Sales Session.</p>}</section> : null}
    {area === "details" ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2 ref={areaHeading} tabIndex={-1}>Details</h2><p>Relationships and configuration retained by Certalis for this Session.</p></div></div><div className={styles.detailGrid}><DetailGroup label="Sales relationship" values={[["Account", workspace.details.accountName], ["Opportunity", workspace.details.opportunityName]]} /><DetailGroup label="Session configuration" values={[["Item", workspace.details.itemName], ["Native invitations", workspace.details.invitationMode], ["Time zone", workspace.summary.timeZone]]} /></div></section> : null}
  </section>;
}

function SummaryMetric({ label, children }: { readonly label: string; readonly children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function DetailGroup({ label, values }: { readonly label: string; readonly values: readonly (readonly [string, string])[] }) { return <section aria-label={label} className={styles.detailGroup}><h3>{label}</h3><dl>{values.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl></section>; }
function ActivityTimeRange({ firstAt, lastAt }: { readonly firstAt: string; readonly lastAt: string }) { return firstAt === lastAt ? <time dateTime={firstAt}>{firstAt}</time> : <span><time dateTime={firstAt}>{firstAt}</time> to <time dateTime={lastAt}>{lastAt}</time></span>; }
function operationPresentation(value: string): { readonly label: string; readonly tone: "positive" | "warning" | "info" } { return value === "needs_attention" ? { label: "Needs attention", tone: "warning" } : value === "provisioning" ? { label: "Provisioning", tone: "info" } : { label: "Correlated", tone: "positive" }; }
function humanExperience(value: string): string { return value === "notStarted" ? "Not started" : value === "inProgress" ? "In progress" : value === "ended" ? "Ended" : "Not observed"; }
function humanInvitation(value: string): string { return value === "sent" ? "Sent" : "Not sent"; }
function humanParticipation(value: string): string { return value === "inProgress" ? "In progress" : value === "concluded" ? "Concluded" : "Pending"; }
function humanEnvironmentSource(value: string): string { if (value === "cloudshare_v3_environment") return "Observed from CloudShare Environment"; if (value === "cloudshare_v4_sales_participant_roster") return "Observed from CloudShare participant roster"; if (value === "not_assigned") return "No CloudShare Environment is assigned"; return "CloudShare Environment state has not been observed"; }
