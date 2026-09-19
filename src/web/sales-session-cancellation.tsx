"use client";
import React, { useEffect, useRef, useState } from "react";
import type { salesCancellationResult } from "@/api/sales-demo-session-cancellation";
type Result = ReturnType<typeof salesCancellationResult>["body"];
export function SalesSessionCancellation({ sessionId, request, onAdmitted }: { sessionId: string; request(url: string, init?: RequestInit): Promise<Response>; onAdmitted(): void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);
  const active = useRef(false);
  const admitted = useRef(onAdmitted);
  admitted.current = onAdmitted;
  const url = `/api/sales/enablement-sessions/${encodeURIComponent(sessionId)}/cancel`;
  const read = async () => {
    setBusy(true);
    try {
      const response = await request(url, { cache: "no-store" });
      if (!response.ok) throw new Error("read_failed");
      const value = await response.json() as Result | null;
      if (value !== null && (typeof value.commandId !== "string" || !Array.isArray(value.targets))) throw new Error("invalid_cancellation_state");
      if (!active.current) return;
      if (value) { setResult(value); commandId.current = value.commandId; admitted.current(); }
      setLoaded(true); setMessage(null);
    } catch { if (active.current) setMessage("Cancellation state could not be read. Retry the status check before cancelling."); }
    finally { if (active.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void read(); return () => { active.current = false; }; }, [url, request]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (mode: "cancel" | "reconcile" | "retrySafe") => {
    if (busy) return;
    commandId.current ??= crypto.randomUUID();
    setBusy(true); setMessage(null); setConfirming(false);
    try {
      const response = await request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId: commandId.current, confirmed: true, ...(mode === "cancel" ? {} : { [mode]: true }) }) });
      const value = await response.json() as Result;
      if (!active.current) return;
      if (!response.ok || !value.commandId || !Array.isArray(value.targets)) {
        setMessage("Cancellation could not proceed. Inspect Support and check the saved cancellation state.");
        return;
      }
      setResult(value); admitted.current();
    } catch { if (active.current) setMessage("The cancellation response was lost. Check the result; do not start another cancellation."); }
    finally { if (active.current) setBusy(false); }
  };
  return <section aria-label="Cancel Sales Enablement Session" style={{ border: "1px solid #d5a6a6", borderRadius: 8, padding: "1rem", marginBlock: "1rem" }}>
    <h2>{result?.status ?? "Cancel Sales Enablement Session"}</h2>
    <p>Cancellation stops access and archives participant environments. The CloudShare Experience and all Session, Participant, Activity and Support history are retained.</p>
    {result ? <><p>Cancellation requested: <time>{result.cancelledAt}</time> (UTC). Experience end and label: {result.accessConfirmed ? "confirmed" : "needs attention"}.</p>
      <ul>{result.targets.map(target => <li key={target.participantId}>{target.participantName}: {target.outcome === "archived" ? "Environment archived" : target.outcome === "no_environment" ? "Never launched; no Environment found" : target.retryable ? "Not attempted; safe retry available" : "Awaiting read-only reconciliation"}</li>)}</ul>
      {result.reconcile ? <button type="button" disabled={busy} onClick={() => void run("reconcile")}>Check cancellation result</button> : null}
      {result.targets.some(t => t.retryable) || result.accessRetryable ? <button type="button" disabled={busy} onClick={() => void run("retrySafe")}>Retry unattempted cancellation steps</button> : null}
      <p><a href={`/sales?tab=support&correlationId=${encodeURIComponent(result.correlationId)}`}>Open cancellation diagnostics</a></p>
    </> : confirming ? <div role="alertdialog" aria-label="Confirm Session cancellation"><p>This ends participant access immediately, archives every currently bound participant Environment, and ends the Sales Experience now. This cannot be undone in Certalis. The Experience and history will not be deleted.</p><button type="button" disabled={busy} onClick={() => void run("cancel")}>Confirm cancellation</button><button type="button" onClick={() => setConfirming(false)}>Keep Session</button></div>
      : <button type="button" disabled={busy || !loaded || commandId.current !== null} onClick={() => setConfirming(true)}>Cancel Session</button>}
    {message ? <p role="status">{message} <button type="button" disabled={busy} onClick={() => void read()}>Check saved cancellation state</button> <a href={commandId.current ? `/sales?tab=support&correlationId=${encodeURIComponent(commandId.current)}` : "/sales?tab=support"}>Open Support</a></p> : null}
  </section>;
}
