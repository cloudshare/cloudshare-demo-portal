"use client";
import React, { useEffect, useRef, useState } from "react";
import type { SalesParticipantWorkspaceRow } from "@/domain/sales-participant-workspace";
type Selection = { mode: "all"; excludedIds: string[] } | { mode: "selected"; participantIds: string[] };
type ExtensionResult = { commandId: string; selection: Selection; outcome: string; finished: boolean; reconcile?: boolean; sessionEnd?: string | null; timeZone?: string; targets: { participantId: string; outcome: string; confirmedExpiry: string | null; retryable: boolean }[] };
export function SalesParticipantExtension({ sessionId, rows, request }: { sessionId: string; rows: readonly SalesParticipantWorkspaceRow[]; request(url: string, init?: RequestInit): Promise<Response> }) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [result, setResult] = useState<ExtensionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const command = useRef<{ commandId: string; selection: Selection } | null>(null);
  const url = `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/participants/extend`;
  useEffect(() => {
    const current = ++generation.current;
    void request(url, { cache: "no-store" }).then(async response => {
      const body = await response.json() as ExtensionResult | null;
      if (generation.current !== current || !response.ok || !body?.commandId || !Array.isArray(body.targets)) return;
      setResult(body);
      if (!body.finished) command.current = { commandId: body.commandId, selection: body.selection };
    }).catch(() => {});
    return () => { generation.current += 1; };
  }, [request, url]);
  const run = async (action: "extend" | "reconcile" | "retry") => {
    if (busy) return;
    const current = ++generation.current;
    const retryIds = result?.targets.filter(target => target.retryable).map(target => target.participantId) ?? [];
    const input = action === "extend" || (action === "retry" && result?.finished)
      ? { commandId: crypto.randomUUID(), selection: action === "retry" ? { mode: "selected" as const, participantIds: retryIds } : { mode: "all" as const, excludedIds: excluded } }
      : command.current;
    if (!input) return;
    command.current = input;
    setBusy(true);
    setMessage(null);
    try {
      const response = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, ...(action === "reconcile" ? { reconcile: true } : action === "retry" && !result?.finished ? { retrySafe: true } : {}) }) });
      const body = await response.json() as ExtensionResult & { error?: string };
      if (generation.current !== current) return;
      if (body.commandId && Array.isArray(body.targets)) {
        setResult(body);
        if (body.finished) command.current = null;
      } else {
        command.current = null;
        setMessage(body.error ?? "Extension preflight failed. Open Support before trying again.");
      }
    } catch {
      if (generation.current === current) {
        setMessage("The extension response was lost. Check its result before another extension.");
        setResult({ ...input, outcome: "needs_attention", finished: false, reconcile: true, targets: [] });
      }
    } finally { if (generation.current === current) setBusy(false); }
  };
  const eligible = rows.filter(row => row.participationStatus !== "concluded" && (row.environment.value === "Ready" || row.environment.value === "Suspended"));
  return <fieldset aria-label="Extend Participant environments" disabled={busy}>
    <legend>Extend Participant environments</legend>
    <p>All eligible active Participants across every page are selected by default. Deselect people on this page to narrow the extension. CloudShare determines the added time.</p>
    <div>{eligible.map(row => <label key={row.id} style={{ display: "inline-flex", gap: 6, marginRight: 16 }}><input type="checkbox" aria-label={`Extend ${row.name}`} checked={!excluded.includes(row.id)} disabled={Boolean(result && !result.finished)} onChange={event => setExcluded(current => event.target.checked ? current.filter(id => id !== row.id) : [...current, row.id])} />{row.name}</label>)}</div>
    {excluded.length ? <p>{excluded.length} Participant{excluded.length === 1 ? "" : "s"} excluded across pages. <button type="button" onClick={() => setExcluded([])}>Select all eligible</button></p> : null}
    <button type="button" disabled={Boolean(result && !result.finished)} onClick={() => void run("extend")}>Extend selected Participants</button>
    {result && !result.finished ? <button type="button" onClick={() => void run("reconcile")}>Check extension result</button> : null}
    {result?.targets.some(target => target.retryable) ? <button type="button" onClick={() => void run("retry")}>Retry unattempted Participants</button> : null}
    {busy || message || result ? <div role="status" aria-label="Extension result" aria-live="polite">
      {busy ? <p>Checking and extending Participant access…</p> : null}
      {message ? <p>{message}</p> : null}
      {result ? <><p>{result.outcome === "completed" ? "Extension completed." : result.finished ? "Extension partially completed. Review each Participant result." : "Extension needs attention. Check the result; dispatched extensions will not be replayed."}</p>
        {result.sessionEnd ? <p>Confirmed Session access until {result.sessionEnd} ({result.timeZone}).</p> : null}
        <ul>{result.targets.map(target => <li key={target.participantId}>{rows.find(row => row.id === target.participantId)?.name ?? "Participant on another page"}: {target.outcome === "confirmed" ? `confirmed expiry ${target.confirmedExpiry} (UTC)` : target.retryable ? "not attempted; safe to retry" : "awaiting provider readback; no replay"}</li>)}</ul>
        <a href={`/sales?tab=support&correlationId=${encodeURIComponent(result.commandId)}`}>Open extension diagnostics</a></> : null}
    </div> : null}
  </fieldset>;
}
