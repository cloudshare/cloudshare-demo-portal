"use client";
import React, { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { compactButtonStyle, disabledButtonStyle } from "./button-styles";
import { colors, spacing, radius } from "./design-tokens";
import type { TrialRdpStatus } from "@/api/sales-trial-rdp";
export function SalesTrialRdp({ offeringId, title = "Trial", active = true, fetchImpl = fetch }: { offeringId: string; title?: string; active?: boolean; fetchImpl?: typeof fetch }) {
 const [status, setStatus] = useState<TrialRdpStatus | null>(null);
 const [loading, setLoading] = useState(false);
 const [dialogOpen, setDialogOpen] = useState(false);
 const trigger = useRef<HTMLButtonElement>(null);
 useEffect(() => { if (!active) setDialogOpen(false); }, [active]);
 function closeDialog() { setDialogOpen(false); queueMicrotask(() => trigger.current?.focus()); }
 async function check() {
  if (loading || status?.state === "ready") return;
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
 if (!active) return null;
 return <>
  <button ref={trigger} type="button" style={actionStyle} onClick={() => setDialogOpen(true)}>Remote desktops</button>
  {dialogOpen && <RemoteDesktopDialog title={title} onDismiss={closeDialog}>
   <button type="button" style={{ ...actionStyle, ...(loading || status?.state === "ready" ? disabledButtonStyle : {}) }} disabled={loading || status?.state === "ready"} onClick={() => void check()}>{loading ? "Checking desktops..." : "Check remote desktops"}</button>
   <div aria-live="polite" style={stackStyle}>
    {status?.message && <p style={copyStyle}>{status.message}</p>}
    {status?.machines?.map(vm => <div key={`${offeringId}:${vm.selector}`} style={machineStyle}>
     <div style={machineHeadingStyle}>
      <strong style={{ overflowWrap: "anywhere", color: colors.textPrimary }}>{vm.name}</strong>
      <span style={copyStyle}>{vm.state === "ready" ? "Ready" : vm.message ?? (vm.state === "preparing" ? "Preparing" : "Remote desktop unavailable")}</span>
     </div>
     {vm.state === "ready" && <div style={actionsStyle}>
      <a style={{ ...actionStyle, textDecoration: "none" }} aria-label={`Download RDP for ${vm.name}`} href={`/api/sales-trial/offerings/${encodeURIComponent(offeringId)}/rdp/${encodeURIComponent(vm.selector)}`} download target="_blank" rel="noreferrer">Download RDP</a>
      <GuestCredentials offeringId={offeringId} selector={vm.selector} name={vm.name} fetchImpl={fetchImpl} />
     </div>}
    </div>)}
   </div>
  </RemoteDesktopDialog>}
 </>;
}

function RemoteDesktopDialog({ title, onDismiss, children }: { title: string; onDismiss: () => void; children: React.ReactNode }) {
 const dialog = useRef<HTMLDialogElement>(null);
 const titleId = useId();
 useEffect(() => {
  const element = dialog.current!;
  element.showModal();
  return () => element.close();
 }, []);
 return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onDismiss(); }} style={dialogStyle}>
  <div style={dialogHeaderStyle}>
   <h2 id={titleId} style={{ margin: 0, fontSize: "1.1rem", overflowWrap: "anywhere" }}>Remote desktops - {title}</h2>
   <button type="button" autoFocus style={actionStyle} onClick={onDismiss}>Close remote desktops</button>
  </div>
  <div style={dialogBodyStyle}>{children}</div>
 </dialog>;
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
   if (current === generation.current) { setOpen(false); setMessage("Guest credentials are unavailable. Try again later or use the trial window."); }
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
  {!open && <button type="button" style={actionStyle} aria-label={`Show credentials for ${name}`} onClick={() => void retrieve()}>Show credentials</button>}
  {open && <div role="group" aria-label={`Guest credentials for ${name}`} style={credentialPanelStyle}>
   {credentials && <p style={copyStyle}>Guest credentials for your native RDP client. Hide or dismiss clears these values here. Copies remain on your clipboard.</p>}
   <button type="button" style={actionStyle} onClick={dismiss}>Dismiss credentials</button>
   {credentials && (["username", "password"] as const).map(field => <div key={field} style={credentialRowStyle}>
    <label style={fieldLabelStyle}>Guest {field}<input style={inputStyle} aria-label={`Guest ${field}`} type={visible[field] ? "text" : "password"} value={credentials[field]} readOnly autoComplete="off" /></label>
    <div style={actionsStyle}>
    <button type="button" style={actionStyle} onClick={() => visible[field] ? dismiss() : setVisible(value => ({ ...value, [field]: true }))}>{visible[field] ? "Hide" : "Show"} {field}</button>
    <button type="button" style={actionStyle} onClick={() => void copy(field)}>Copy {field}</button>
    </div>
   </div>)}
  </div>}
  {message && <p role="status" style={{ ...copyStyle, flexBasis: "100%" }}>{message}</p>}
 </>;
}

const stackStyle: CSSProperties = { display: "grid", gap: spacing.sm, minWidth: 0 };
const copyStyle: CSSProperties = { margin: 0, color: colors.textSecondary, lineHeight: 1.5, overflowWrap: "anywhere" };
const actionStyle: CSSProperties = { ...compactButtonStyle, cursor: "pointer", minHeight: "2.25rem", maxWidth: "100%", boxSizing: "border-box", textAlign: "center" };
const machineStyle: CSSProperties = { ...stackStyle, border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: spacing.sm, background: colors.surfaceMuted };
const credentialPanelStyle: CSSProperties = { ...stackStyle, flexBasis: "100%", justifyItems: "start", borderTop: `1px solid ${colors.borderStrong}`, paddingTop: spacing.md };
const credentialRowStyle: CSSProperties = { ...stackStyle, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))", alignItems: "end" };
const fieldLabelStyle: CSSProperties = { display: "grid", gap: spacing.xs, minWidth: 0, fontWeight: 600, color: colors.textPrimary };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", border: `1px solid ${colors.borderStrong}`, borderRadius: radius.sm, padding: "0.5rem", fontSize: "1rem", lineHeight: 1.4, background: colors.surface, color: colors.textPrimary };
const actionsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 };

const machineHeadingStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between", alignItems: "baseline", minWidth: 0 };
const dialogStyle: CSSProperties = { width: "min(42rem, calc(100vw - 2rem))", maxWidth: "none", maxHeight: "calc(100dvh - 2rem)", padding: 0, border: `1px solid ${colors.borderStrong}`, borderRadius: radius.lg, boxShadow: "0 20px 60px rgba(15,23,42,0.25)", color: colors.textPrimary, boxSizing: "border-box" };
const dialogHeaderStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, padding: spacing.md, borderBottom: `1px solid ${colors.border}` };
const dialogBodyStyle: CSSProperties = { ...stackStyle, padding: spacing.md, overflowY: "auto", maxHeight: "65dvh", boxSizing: "border-box" };
