"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { statusBadgeStyle } from "./status-badge";
import styles from "./sales-session-workspace.module.css";
import type { SafeSalesSessionActivity, SalesSessionWorkspaceResponse } from "@/domain/sales-session-workspace";

type Area = "participants" | "activity" | "details";
type ActivityGroup = { readonly summary: string; readonly outcome: SafeSalesSessionActivity["outcome"]; readonly actor: string; readonly subject: string; readonly firstAt: string; readonly lastAt: string; readonly count: number; readonly correlationIds: readonly string[] };

export function SalesSessionWorkspace({ sessionId, area, queueHref }: { readonly sessionId: string; readonly area: Area; readonly queueHref: string }) {
  const [workspace, setWorkspace] = useState<SalesSessionWorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const areaHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true;
    const request = createAdminAuthenticatedRequest({ fetchImpl: window.fetch.bind(window), onSessionExpired: () => window.location.assign("/login") });
    void request(`/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/workspace`, { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as SalesSessionWorkspaceResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The Sales Session could not be loaded.");
      if (live) setWorkspace(body);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "The Sales Session could not be loaded."); });
    return () => { live = false; };
  }, [sessionId]);
  useEffect(() => { areaHeading.current?.focus(); }, [area, workspace?.summary.id]);
  const activity = useMemo(() => workspace ? groupSalesSessionActivity(workspace.activity) : [], [workspace]);
  if (error) return <section role="alert" className={styles.error}><h1>Sales Session unavailable</h1><p>{error}</p><a href={queueHref}>Back to Sessions</a></section>;
  if (!workspace) return <section aria-busy="true" aria-label="Sales Session workspace loading" className={styles.loading}>Loading Sales Session…</section>;
  const areaHref = (next: Area) => `/sales/sessions/${encodeURIComponent(sessionId)}?area=${next}&from=${encodeURIComponent(queueHref)}`;
  return <section aria-label="Sales Session workspace" className={styles.workspace}>
    <header className={styles.summary}>
      <div className={styles.summaryTopline}><a href={queueHref}><span aria-hidden="true">← </span>Back to Sessions</a><span>Revision {workspace.summary.revision}</span></div>
      <div className={styles.summaryTitle}><div><p className={styles.eyebrow}>Sales Enablement Session</p><h1>{workspace.summary.sessionName}</h1></div><span className={styles.statusBadge} style={statusBadgeStyle(operationPresentation(workspace.summary.operation.value).tone)}>{operationPresentation(workspace.summary.operation.value).label}</span></div>
      <dl className={styles.summaryMetrics}>
        <SummaryMetric label="Time window"><time dateTime={workspace.summary.start}>{workspace.summary.start}</time><span> · {workspace.summary.timeZone}</span><time dateTime={workspace.summary.end}>{workspace.summary.end}</time></SummaryMetric>
        <SummaryMetric label="Certalis operation"><strong>{operationPresentation(workspace.summary.operation.value).label}</strong><span>{workspace.summary.operation.value === "needs_attention" ? workspace.summary.operation.reason : "Recorded by Certalis."}</span></SummaryMetric>
        <SummaryMetric label="CloudShare Experience"><strong>{humanExperience(workspace.summary.experience.value)}</strong><span>{workspace.summary.experience.freshness === "fresh" ? "Recently observed from CloudShare." : "Schedule estimate; not recently confirmed with CloudShare."}</span></SummaryMetric>
        <SummaryMetric label="Configuration"><strong>{workspace.details.itemName}</strong><span>{workspace.details.invitationMode}</span></SummaryMetric>
      </dl>
    </header>
    <nav aria-label="Sales Session areas" className={styles.areaTabs}>{(["participants", "activity", "details"] as const).map((candidate) => <a key={candidate} className={area === candidate ? styles.areaTabActive : styles.areaTab} href={areaHref(candidate)} aria-current={area === candidate ? "page" : undefined}>{candidate[0].toUpperCase() + candidate.slice(1)}</a>)}</nav>
    {area === "participants" ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2 ref={areaHeading} tabIndex={-1}>Participants</h2><p>Read-only roster preview for this Sales Session.</p></div><span className={styles.count}>{workspace.participants.length} {workspace.participants.length === 1 ? "participant" : "participants"}</span></div>{workspace.participants.length ? <div className={styles.tableWrap}><table aria-label="Participant roster preview" className={styles.roster}><thead><tr><th>Participant</th><th>Invitation</th><th>Participation</th><th>Participant Environment</th><th>Environment source</th></tr></thead><tbody>{workspace.participants.map((participant) => <tr key={participant.id}><th scope="row"><strong>{participant.name}</strong><span>{participant.email}</span></th><td><span className={styles.inlineBadge}>{humanInvitation(participant.invitationStatus)}</span></td><td><span className={styles.inlineBadge}>{humanParticipation(participant.participationStatus)}</span></td><td><span className={styles.srOnly}>Participant Environment: </span>{participant.environment.value ?? "Not observed"}{"observedAt" in participant.environment ? <span className={styles.muted}>{participant.environment.observedAt}</span> : null}{participant.environmentAttention ? <span className={styles.environmentAttention}><strong>Needs attention</strong>{participant.environmentAttention.reason}</span> : null}</td><td>{humanEnvironmentSource(participant.environment.source)}{participant.environmentAttention ? <span className={styles.muted}>Attention source: {participant.environmentAttention.source}</span> : null}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No persisted Participants are registered for this Sales Session.</p>}<p className={styles.previewNote}>Detailed participant management follows in a later workspace. This preview has no participant actions or drill-downs.</p></section> : null}
    {area === "activity" ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2 ref={areaHeading} tabIndex={-1}>Activity</h2><p>Grouped operational history for this Sales Session.</p></div></div><p className={styles.activityExplainer}>Activity shows ordinary operational metadata only. Open Support Diagnostics for authorized Customer-scoped evidence when a correlation is available.</p>{activity.length ? <ol aria-label="Sales Session activity timeline" className={styles.timeline}>{activity.map((entry) => <li key={`${entry.summary}-${entry.firstAt}-${entry.actor}-${entry.subject}`} className={styles.timelineItem}><span className={entry.outcome === "failure" ? styles.failureDot : styles.successDot} aria-hidden="true" /><div className={styles.timelineBody}><div className={styles.timelineTitle}><strong>{entry.summary}</strong><span className={entry.outcome === "failure" ? styles.failureBadge : styles.successBadge}>{entry.outcome === "failure" ? "Failed" : "Completed"}</span></div><div className={styles.timelineMeta}><span>{entry.count === 1 ? "1 event" : `${entry.count} equivalent events`}</span><ActivityTimeRange firstAt={entry.firstAt} lastAt={entry.lastAt} /><span>Actor: {entry.actor}</span><span>Subject: {entry.subject}</span></div>{entry.correlationIds.length ? <details className={styles.correlationThreads}><summary>{entry.correlationIds.length} correlation {entry.correlationIds.length === 1 ? "thread" : "threads"}</summary><div>{entry.correlationIds.map((correlationId) => <a key={correlationId} href={`/sales?tab=support&correlationId=${encodeURIComponent(correlationId)}`}>Open Support Diagnostics · correlation {correlationId}</a>)}</div></details> : null}</div></li>)}</ol> : <p className={styles.empty}>No safe Activity has been recorded for this Sales Session.</p>}</section> : null}
    {area === "details" ? <section className={styles.panel}><div className={styles.panelHeading}><div><h2 ref={areaHeading} tabIndex={-1}>Details</h2><p>Relationships and configuration retained by Certalis for this Session.</p></div></div><div className={styles.detailGrid}><DetailGroup label="Sales relationship" values={[["Account", workspace.details.accountName], ["Opportunity", workspace.details.opportunityName]]} /><DetailGroup label="Session configuration" values={[["Item", workspace.details.itemName], ["Native invitations", workspace.details.invitationMode], ["Time zone", workspace.summary.timeZone]]} /></div></section> : null}
  </section>;
}

export function groupSalesSessionActivity(entries: readonly SafeSalesSessionActivity[]): readonly ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const entry of entries) {
    const actor = entry.actor?.type ?? "Not recorded";
    const key = `${entry.summary}\u0000${entry.outcome}\u0000${actor}\u0000${entry.subject.type}`;
    const current = groups.get(key);
    if (!current) { groups.set(key, { summary: entry.summary, outcome: entry.outcome, actor, subject: entry.subject.type, firstAt: entry.occurredAt, lastAt: entry.occurredAt, count: 1, correlationIds: entry.correlationId ? [entry.correlationId] : [] }); continue; }
    const correlationIds = entry.correlationId && !current.correlationIds.includes(entry.correlationId) ? [...current.correlationIds, entry.correlationId] : current.correlationIds;
    groups.set(key, { ...current, firstAt: entry.occurredAt < current.firstAt ? entry.occurredAt : current.firstAt, lastAt: entry.occurredAt > current.lastAt ? entry.occurredAt : current.lastAt, count: current.count + 1, correlationIds });
  }
  return [...groups.values()].sort((left, right) => right.lastAt.localeCompare(left.lastAt));
}

function SummaryMetric({ label, children }: { readonly label: string; readonly children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function DetailGroup({ label, values }: { readonly label: string; readonly values: readonly (readonly [string, string])[] }) { return <section aria-label={label} className={styles.detailGroup}><h3>{label}</h3><dl>{values.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl></section>; }
function ActivityTimeRange({ firstAt, lastAt }: { readonly firstAt: string; readonly lastAt: string }) { return firstAt === lastAt ? <time dateTime={firstAt}>{firstAt}</time> : <span><time dateTime={firstAt}>{firstAt}</time> to <time dateTime={lastAt}>{lastAt}</time></span>; }
function operationPresentation(value: string): { readonly label: string; readonly tone: "positive" | "warning" | "info" } { return value === "needs_attention" ? { label: "Needs attention", tone: "warning" } : value === "provisioning" ? { label: "Provisioning", tone: "info" } : { label: "Correlated", tone: "positive" }; }
function humanExperience(value: string): string { return value === "notStarted" ? "Not started" : value === "inProgress" ? "In progress" : value === "ended" ? "Ended" : "Not observed"; }
function humanInvitation(value: string): string { return value === "sent" ? "Sent" : "Not sent"; }
function humanParticipation(value: string): string { return value === "inProgress" ? "In progress" : value === "concluded" ? "Concluded" : "Pending"; }
function humanEnvironmentSource(value: string): string { if (value === "cloudshare_v3_environment") return "Observed from CloudShare Environment"; if (value === "cloudshare_v4_sales_participant_roster") return "Observed from CloudShare participant roster"; if (value === "not_assigned") return "No CloudShare Environment is assigned"; return "CloudShare Environment state has not been observed"; }
