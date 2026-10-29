"use client";
import React, { useState } from "react";
import type { TrialRdpStatus } from "@/api/sales-trial-rdp";
export function SalesTrialRdp({ offeringId, fetchImpl = fetch }: { offeringId: string; fetchImpl?: typeof fetch }) {
 const [status, setStatus] = useState<TrialRdpStatus | null>(null);
 const [loading, setLoading] = useState(false);
 async function check() {
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
   {status?.machines?.map(vm => <div key={vm.selector} style={{ marginTop: "0.75rem" }}>
    {vm.state === "ready" ? <><span>{vm.name}</span>{" — "}<a aria-label={`Download RDP for ${vm.name}`} href={`/api/sales-trial/offerings/${encodeURIComponent(offeringId)}/rdp/${encodeURIComponent(vm.selector)}`} download target="_blank" rel="noreferrer">Download RDP</a></> : <span>{vm.name} — {vm.message ?? (vm.state === "preparing" ? "preparing" : "remote desktop unavailable")}</span>}
   </div>)}
  </div>
 </section>;
}

