"use client";

import React, { useCallback, useEffect, useState } from "react";
import { disabledButtonStyle, primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";

type Item = { id: string; name: string; defaultDurationMinutes: number };
type Timezone = { id: string; name: string };
type Member = { email: string; displayName: string };
type MonitoringParticipant = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  participationStatus: "pending" | "inProgress" | "concluded";
  firstJoined: string | null;
  envStatus: string | null;
  environment: { dimension: "cloudshare_environment"; value: string | null; source: string };
  needsAttention?: boolean;
  monitoringMessage?: string;
};
type Offering = {
  id: string;
  title: string;
  description: string;
  itemId: string;
  start: string;
  end: string;
  timeZone: string;
  salesProEmail: string;
  salesProDisplayName: string | null;
  status: "draft" | "published" | "unpublished" | "needs_attention";
  attentionReason: string | null;
};

const controlStyle = {
  width: "100%",
  minWidth: 0,
  padding: "0.7rem 0.8rem",
  border: "1px solid #b7bdc8",
  borderRadius: "6px",
  background: "#ffffff",
  color: "#17243a",
  boxSizing: "border-box" as const,
};

export function SalesTrialOfferingsAdmin({
  email,
  fetchAdmin = fetch,
}: {
  readonly email: string;
  readonly fetchAdmin?: typeof fetch;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [timezones, setTimezones] = useState<Timezone[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [monitoringOfferingId, setMonitoringOfferingId] = useState<string | null>(null);
  const [monitoringParticipants, setMonitoringParticipants] = useState<MonitoringParticipant[]>([]);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    itemId: "",
    start: "",
    end: "",
    timeZone: "UTC",
    salesProEmail: "",
  });

  const loadOfferings = useCallback(async () => {
    const response = await fetchAdmin("/api/sales/trial-offerings");
    const body = (await response.json()) as { offerings?: Offering[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not load Trial Offerings.");
    setOfferings(body.offerings ?? []);
  }, [fetchAdmin]);

  useEffect(() => {
    void Promise.all([
      fetchAdmin("/api/sales/items").then(async (response) => {
        const body = (await response.json()) as { activeItems?: Item[] };
        setItems(body.activeItems ?? []);
      }),
      fetchAdmin("/api/sales/timezones").then(async (response) => {
        const body = (await response.json()) as { timezones?: Timezone[] };
        setTimezones(body.timezones ?? []);
      }),
      loadOfferings(),
    ]).catch((error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Load failed.");
    });
  }, [fetchAdmin, loadOfferings]);

  useEffect(() => {
    if (!form.itemId) {
      setMembers([]);
      setForm((current) => ({ ...current, salesProEmail: "" }));
      return;
    }
    void fetchAdmin(`/api/sales/enablement-sessions/project-members?itemId=${encodeURIComponent(form.itemId)}`)
      .then(async (response) => {
        const body = (await response.json()) as { members?: Member[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not retrieve active Project members.");
        setMembers(body.members ?? []);
      })
      .catch((error) => {
        setMessageTone("error");
        setMessage(error instanceof Error ? error.message : "Load failed.");
      });
  }, [fetchAdmin, form.itemId]);

  async function createDraft() {
    setMessage(null);
    const response = await fetchAdmin("/api/sales/trial-offerings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessageTone("error");
      setMessage(body.error ?? "Could not create Trial Offering.");
      return;
    }
    setForm({
      title: "",
      description: "",
      itemId: "",
      start: "",
      end: "",
      timeZone: "UTC",
      salesProEmail: "",
    });
    await loadOfferings();
    setMessageTone("success");
    setMessage("Trial Offering draft saved.");
  }

  async function lifecycle(id: string, action: "publish" | "unpublish") {
    setMessage(null);
    const response = await fetchAdmin(`/api/sales/trial-offerings/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessageTone("error");
      setMessage(body.error ?? `Could not ${action} Trial Offering.`);
      return;
    }
    await loadOfferings();
    setMessageTone("success");
    setMessage(action === "publish" ? "Trial Offering published." : "Trial Offering unpublished.");
  }

  async function toggleMonitoring(id: string) {
    if (monitoringOfferingId === id) {
      setMonitoringOfferingId(null);
      setMonitoringParticipants([]);
      setMonitoringError(null);
      return;
    }
    setMonitoringLoading(true);
    setMonitoringOfferingId(id);
    setMonitoringError(null);
    try {
      const response = await fetchAdmin(
        `/api/sales/trial-offerings/${encodeURIComponent(id)}/participants`,
      );
      const body = (await response.json()) as {
        participants?: MonitoringParticipant[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not load participant monitoring.");
      }
      setMonitoringParticipants(body.participants ?? []);
    } catch (error) {
      setMonitoringParticipants([]);
      setMonitoringError(
        error instanceof Error ? error.message : "Could not load participant monitoring.",
      );
    } finally {
      setMonitoringLoading(false);
    }
  }

  return (
    <section aria-label="Trial Offerings" style={{ display: "grid", gap: "1.5rem" }}>
      <section style={{ ...mutedPanelStyle, display: "grid", gap: "0.8rem" }}>
        <p style={{ margin: 0, color: "#35556f", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Sales operations</p>
        <h1 style={{ margin: 0 }}>Trial Offerings</h1>
        <p style={{ margin: 0, color: "#52606d" }}>
          Publish one shared CloudShare Sales Experience of type <code>trial</code> without adding participants or exposing provider identifiers in the ordinary UI.
        </p>
        <p style={{ margin: 0, color: "#52606d" }}>
          This section is separate from Sales Sessions so Certalis can author and publish a reusable trial catalogue entry before any participant enrollment or launch flow exists. Signed in as {email}.
        </p>
      </section>
      <section style={{ ...cardStyle, display: "grid", gap: "1.1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <p style={{ margin: 0, color: "#35556f", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Authoring</p>
            <h2 style={{ margin: 0 }}>Create draft</h2>
            <p style={{ margin: 0, color: "#52606d" }}>Reuse an existing Sales Item and assign one active Project member as the Sales Pro for the shared trial window.</p>
          </div>
        </div>
        <div style={{ display: "grid", gap: "1rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>Title<input style={controlStyle} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>Description<textarea style={{ ...controlStyle, minHeight: "5.5rem", resize: "vertical" as const }} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>Item<select style={controlStyle} value={form.itemId} onChange={(event) => setForm((current) => ({ ...current, itemId: event.target.value }))}><option value="">Select an Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.9rem" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>Start<input style={controlStyle} type="datetime-local" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} /></label>
            <label style={{ display: "grid", gap: "0.35rem" }}>End<input style={controlStyle} type="datetime-local" value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} /></label>
            <label style={{ display: "grid", gap: "0.35rem" }}>Time zone<input style={controlStyle} list="trial-offering-timezones" value={form.timeZone} onChange={(event) => setForm((current) => ({ ...current, timeZone: event.target.value }))} /><datalist id="trial-offering-timezones">{timezones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</datalist></label>
            <label style={{ display: "grid", gap: "0.35rem" }}>Sales Pro<select style={controlStyle} value={form.salesProEmail} onChange={(event) => setForm((current) => ({ ...current, salesProEmail: event.target.value }))}><option value="">Select an active Project member</option>{members.map((member) => <option key={member.email} value={member.email}>{member.displayName} ({member.email})</option>)}</select></label>
          </div>
        </div>
        <button type="button" onClick={() => void createDraft()} style={primaryButtonStyle}>Save draft</button>
        {message ? <div role={messageTone === "error" ? "alert" : "status"} style={messageTone === "error" ? alertPanelStyle.danger : alertPanelStyle.success}>{message}</div> : null}
      </section>
      <section style={{ ...cardStyle, display: "grid", gap: "1rem" }}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <p style={{ margin: 0, color: "#35556f", fontSize: "0.82rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Queue</p>
          <h2 style={{ margin: 0 }}>Current Offerings</h2>
          <p style={{ margin: 0, color: "#52606d" }}>Drafts stay internal to Certalis Sales Admins until explicitly published. Published offerings remain metadata-only in the ordinary UI.</p>
        </div>
        {offerings.length === 0 ? <p style={{ margin: 0, color: "#52606d" }}>No Trial Offerings yet.</p> : offerings.map((offering) => <article key={offering.id} style={{ border: "1px solid #dbe4ee", borderRadius: "10px", padding: "1rem", display: "grid", gap: "0.6rem", background: "#fbfdff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: "0.2rem" }}>
              <h3 style={{ margin: 0 }}>{offering.title}</h3>
              <p style={{ margin: 0, color: "#52606d" }}>{offering.description || "No description provided."}</p>
            </div>
            <strong style={{ textTransform: "capitalize", color: offering.status === "needs_attention" ? "#9a3412" : "#35556f" }}>{offering.status.replaceAll("_", " ")}</strong>
          </div>
          <p style={{ margin: 0 }}>{offering.start} to {offering.end} ({offering.timeZone})</p>
          <p style={{ margin: 0 }}>Sales Pro: {offering.salesProDisplayName ?? offering.salesProEmail}</p>
          {offering.attentionReason ? <div style={alertPanelStyle.warning}>{offering.attentionReason}</div> : null}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <button type="button" style={offering.status !== "draft" ? { ...primaryButtonStyle, ...disabledButtonStyle } : primaryButtonStyle} disabled={offering.status !== "draft"} onClick={() => void lifecycle(offering.id, "publish")}>Publish</button>
            <button type="button" style={offering.status !== "published" ? { ...secondaryButtonStyle, ...disabledButtonStyle } : secondaryButtonStyle} disabled={offering.status !== "published"} onClick={() => void lifecycle(offering.id, "unpublish")}>Unpublish</button>
            {offering.status === "published" ? <button type="button" style={secondaryButtonStyle} onClick={() => void toggleMonitoring(offering.id)}>{monitoringOfferingId === offering.id ? "Hide monitoring" : "Open monitoring"}</button> : null}
          </div>
          {monitoringOfferingId === offering.id ? <section aria-label="Participant monitoring" style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem", overflowX: "auto", width: "100%" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Participant monitoring</strong>
              <span style={{ color: "#52606d" }}>CloudShare visibility derived from the reconciled Trial enrollment roster.</span>
            </div>
            {monitoringLoading ? <p style={{ margin: 0 }}>Refreshing participant monitoring…</p> : null}
            {monitoringError ? <div role="alert" style={alertPanelStyle.danger}>{monitoringError}</div> : null}
            {!monitoringLoading && !monitoringError && monitoringParticipants.length === 0 ? <p style={{ margin: 0, color: "#52606d" }}>No enrolled participants are currently visible for this Trial Offering.</p> : null}
            {!monitoringLoading && !monitoringError && monitoringParticipants.length > 0 ? <table style={{ width: "100%", minWidth: "42rem", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #dbe4ee" }}>Participant</th>
                  <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #dbe4ee" }}>First joined</th>
                  <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #dbe4ee" }}>Participation</th>
                  <th style={{ textAlign: "left", padding: "0.45rem", borderBottom: "1px solid #dbe4ee" }}>Environment</th>
                </tr>
              </thead>
              <tbody>
                {monitoringParticipants.map((participant) => <tr key={participant.id}>
                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #eef2f7" }}><strong>{participant.firstName} {participant.lastName}</strong><br /><span>{participant.email}</span>{participant.needsAttention ? <><br /><small style={{ color: "#9a3412" }}>{participant.monitoringMessage}</small></> : null}</td>
                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #eef2f7" }}>{participant.firstJoined ?? "—"}</td>
                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #eef2f7" }}>{participant.participationStatus}</td>
                  <td style={{ padding: "0.45rem", borderBottom: "1px solid #eef2f7" }}>{participant.environment.value ?? participant.envStatus ?? "Not assigned"}</td>
                </tr>)}
              </tbody>
            </table> : null}
          </section> : null}
        </article>)}
      </section>
    </section>
  );
}
