"use client";
import React, { useEffect, useRef, useState } from "react";
import type { TrialRdpStatus } from "@/api/sales-trial-rdp";
export function SalesTrialRdp({ offeringId, fetchImpl = fetch }: { offeringId: string; fetchImpl?: typeof fetch }) {
 const [status, setStatus] = useState<TrialRdpStatus | null>(null);
 const [loading, setLoading] = useState(false);
 async function check() {
  setStatus(null);
  setLoading(true);
  try {
   const response = await fetchImpl(`/api/sales-trial/offerings/${encodeURIComponent(offeringId)}/rdp`, { cache: "no-store" });
   if (!response.ok) throw new Error("Unavailable");
   setStatus(await response.json() as TrialRdpStatus);
  } catch {
   setStatus({ state: "unavailable", message: "Remote desktop is unavailable. You can still open the trial window." });
  } finally { setLoading(false); }
 }
 return <section aria-label="Remote desktop" style={{ padding: "1rem", borderTop: "1px solid #d9e2ec" }}>
  <button type="button" disabled={loading} onClick={() => void check()}>{loading ? "Checking desktops…" : "Check remote desktops"}</button>
  <div aria-live="polite">
   {status?.message && <p>{status.message}</p>}
   {status?.machines?.map(vm => <div key={`${offeringId}:${vm.selector}`} style={{ marginTop: "0.75rem" }}>
    {vm.state === "ready" ? <><span>{vm.name}</span>{" — "}<a aria-label={`Download RDP for ${vm.name}`} href={`/api/sales-trial/offerings/${encodeURIComponent(offeringId)}/rdp/${encodeURIComponent(vm.selector)}`} download target="_blank" rel="noreferrer">Download RDP</a>{" "}<GuestCredentials offeringId={offeringId} selector={vm.selector} name={vm.name} fetchImpl={fetchImpl} /></> : <span>{vm.name} — {vm.message ?? (vm.state === "preparing" ? "preparing" : "remote desktop unavailable")}</span>}
   </div>)}
  </div>
 </section>;
}


function GuestCredentials({ offeringId, selector, name, fetchImpl }: { offeringId: string; selector: string; name: string; fetchImpl: typeof fetch }) {
 const [open, setOpen] = useState(false);
 const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
 const [visible, setVisible] = useState({ username: false, password: false });
 const [message, setMessage] = useState("");
 const generation = useRef(0);
 function dismiss() {
  generation.current++;
  setCredentials(null);
  setVisible({ username: false, password: false });
  setMessage("");
  setOpen(false);
 }
 useEffect(() => {
  const pendingRequests = generation;
  window.addEventListener("pagehide", dismiss);
  return () => { pendingRequests.current++; window.removeEventListener("pagehide", dismiss); };
 }, []);
 async function retrieve() {
  const current = ++generation.current;
  setOpen(true);
  setMessage("Retrieving guest credentials...");
  try {
   const response = await fetchImpl(`/api/sales-trial/offerings/${encodeURIComponent(offeringId)}/rdp/${encodeURIComponent(selector)}/credentials`, { method: "POST", cache: "no-store" });
   if (!response.ok) throw new Error("Unavailable");
   const data: unknown = await response.json();
   if (!data || typeof data !== "object" || !("username" in data) || !("password" in data) || typeof data.username !== "string" || typeof data.password !== "string" || !data.username || !data.password) throw new Error("Unavailable");
   if (current !== generation.current) return;
   setCredentials({ username: data.username, password: data.password });
   setMessage("");
  } catch {
   if (current === generation.current) setMessage("Guest credentials are unavailable. Try again later or use the trial window.");
  }
 }
 async function copy(field: "username" | "password") {
  if (!credentials) return;
  const current = generation.current;
  try {
   await navigator.clipboard.writeText(credentials[field]);
   if (current === generation.current) setMessage(`Guest ${field} copied to your clipboard.`);
  } catch {
   if (current === generation.current) setMessage("Copy was unavailable. Show the value and copy it manually.");
  }
 }
 return <>
  {!open && <button type="button" aria-label={`Show credentials for ${name}`} onClick={() => void retrieve()}>Show credentials</button>}
  {open && <div role="group" aria-label={`Guest credentials for ${name}`}>
   <p>Guest credentials for your native RDP client. Hide or dismiss clears these values here. Copies remain on your clipboard.</p>
   <button type="button" onClick={dismiss}>Dismiss credentials</button>
   {credentials && (["username", "password"] as const).map(field => <div key={field}>
    <label>Guest {field}<input aria-label={`Guest ${field}`} type={visible[field] ? "text" : "password"} value={credentials[field]} readOnly autoComplete="off" /></label>
    <button type="button" onClick={() => visible[field] ? dismiss() : setVisible(value => ({ ...value, [field]: true }))}>{visible[field] ? "Hide" : "Show"} {field}</button>
    <button type="button" onClick={() => void copy(field)}>Copy {field}</button>
   </div>)}
   {message && <p role="status">{message}</p>}
  </div>}
 </>;
}
