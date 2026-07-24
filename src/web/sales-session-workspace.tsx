"use client";

import React, { useEffect, useRef, useState } from "react";
import { createAdminAuthenticatedRequest } from "./admin-authenticated-request";
import { cardStyle } from "./card-styles";
import type { SalesSessionWorkspaceResponse } from "@/domain/sales-session-workspace";

type Area = "participants" | "activity" | "details";

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
  if (error) return <section role="alert" style={cardStyle}><h1>Sales Session unavailable</h1><p>{error}</p><a href={queueHref}>Back to Sessions</a></section>;
  if (!workspace) return <section aria-busy="true" aria-label="Sales Session workspace loading" style={cardStyle}>Loading Sales Session…</section>;
  const areaHref = (next: Area) => `/sales/sessions/${encodeURIComponent(sessionId)}?area=${next}&from=${encodeURIComponent(queueHref)}`;
  return <section aria-label="Sales Session workspace" style={{ display: "grid", gap: "1rem", minWidth: 0 }}>
    <header style={{ ...cardStyle, position: "sticky", top: 0, zIndex: 1 }}><a href={queueHref}>Back to Sessions</a><h1>{workspace.summary.sessionName}</h1><p>Revision {workspace.summary.revision}</p><dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))", gap: "0.75rem", margin: 0 }}><div><dt>Time window</dt><dd>{workspace.summary.start} · {workspace.summary.timeZone}<br />{workspace.summary.end} · {workspace.summary.timeZone}</dd></div><div><dt>Certalis operation</dt><dd>{humanOperation(workspace.summary.operation.value)}{workspace.summary.operation.value === "needs_attention" ? <><br /><small>{workspace.summary.operation.reason}</small></> : <><br /><small>Recorded by Certalis.</small></>}</dd></div><div><dt>CloudShare Experience</dt><dd>{humanExperience(workspace.summary.experience.value)}<br /><small>{workspace.summary.experience.freshness === "fresh" ? "Recently observed from CloudShare." : "Estimated from the Session schedule — not recently confirmed with CloudShare."}</small></dd></div><div><dt>Configuration</dt><dd>{workspace.details.itemName}<br /><small>{workspace.details.invitationMode}</small></dd></div></dl></header>
    <nav aria-label="Sales Session areas" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>{(["participants", "activity", "details"] as const).map((candidate) => <a key={candidate} href={areaHref(candidate)} aria-current={area === candidate ? "page" : undefined}>{candidate[0].toUpperCase() + candidate.slice(1)}</a>)}</nav>
    {area === "participants" ? <section style={cardStyle}><h2 ref={areaHeading} tabIndex={-1}>Participants</h2>{workspace.participants.length ? <ul>{workspace.participants.map((participant) => <li key={participant.id}><strong>{participant.name}</strong> · {participant.email} · {participant.invitationStatus} · {participant.participationStatus}<br /><small>Participant Environment: {participant.environment.value ?? "Not observed"} · {humanEnvironmentSource(participant.environment.source)}{"observedAt" in participant.environment ? ` · ${participant.environment.observedAt}` : ""}</small></li>)}</ul> : <p>No persisted Participants are registered for this Sales Session.</p>}</section> : null}
    {area === "activity" ? <section style={cardStyle}><h2 ref={areaHeading} tabIndex={-1}>Activity</h2>{workspace.activity.length ? <ul>{workspace.activity.map((entry, index) => <li key={`${entry.occurredAt}-${index}`}><time dateTime={entry.occurredAt}>{entry.occurredAt}</time> · {entry.summary} · Actor: {entry.actor?.type ?? "Not recorded"} · Subject: {entry.subject.type}{entry.correlationId ? <> · <a href={`/sales?tab=support&correlationId=${encodeURIComponent(entry.correlationId)}`}>Open Support Diagnostics</a></> : null}</li>)}</ul> : <p>No safe Activity has been recorded for this Sales Session.</p>}</section> : null}
    {area === "details" ? <section style={cardStyle}><h2 ref={areaHeading} tabIndex={-1}>Details</h2><dl><dt>Account</dt><dd>{workspace.details.accountName}</dd><dt>Opportunity</dt><dd>{workspace.details.opportunityName}</dd><dt>Item</dt><dd>{workspace.details.itemName}</dd><dt>Native invitations</dt><dd>{workspace.details.invitationMode}</dd></dl></section> : null}
  </section>;
}
function humanOperation(value: string): string { return value === "needs_attention" ? "Needs attention" : value === "provisioning" ? "Provisioning" : "Correlated"; }
function humanExperience(value: string): string { return value === "notStarted" ? "Not started" : value === "inProgress" ? "In progress" : value === "ended" ? "Ended" : "Not observed"; }
function humanEnvironmentSource(value: string): string {
  if (value === "cloudshare_v3_environment") return "Observed from CloudShare Environment";
  if (value === "cloudshare_v4_sales_participant_roster") return "Observed from CloudShare participant roster";
  if (value === "not_assigned") return "No CloudShare Environment is assigned";
  return "CloudShare Environment state has not been observed";
}
