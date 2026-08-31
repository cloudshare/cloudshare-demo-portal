"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  SalesTrialMonitoringObservation,
  SalesTrialMonitoringParticipant,
  SalesTrialOfferingMonitoringResponseBody,
} from "@/api/sales-trial-enrollment";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
import { disabledButtonStyle, primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";
import { colors } from "./design-tokens";

type Item = { id: string; name: string; defaultDurationMinutes: number };
type Timezone = { id: string; name: string };
type Member = { email: string; displayName: string };
type DraftPayload = {
  title: string;
  description: string;
  itemId: string;
  start: string;
  end: string | null;
  noEndDate: boolean;
  timeZone: string;
  salesProEmail: string;
};
type DraftFormField = "title" | "description" | "itemId" | "start" | "end" | "timeZone" | "salesProEmail";
type Offering = {
  id: string;
  title: string;
  description: string;
  itemId: string;
  start: string;
  end: string | null;
  timeZone: string;
  salesProEmail: string;
  salesProDisplayName: string | null;
  status: "draft" | "published" | "ending" | "ended" | "unpublished" | "needs_attention";
  attentionReason: string | null;
  endingCalculatedEnd: string | null;
  endingLastReconciledAt: string | null;
};
type NavigationIntent = {
  readonly tab: "support";
  readonly correlationId?: string | null;
  readonly source?: string | null;
  readonly subjectId?: string | null;
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
const disabledControlStyle = {
  background: colors.surfaceSubtle,
  color: colors.textMuted,
  border: `1px solid ${colors.borderStrong}`,
  cursor: "not-allowed",
};

export function SalesTrialOfferingsAdmin({
  email,
  fetchAdmin = fetch,
  onNavigate,
}: {
  readonly email: string;
  readonly fetchAdmin?: typeof fetch;
  readonly onNavigate?: (intent: NavigationIntent) => void;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [timezones, setTimezones] = useState<Timezone[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [messageCorrelationId, setMessageCorrelationId] = useState<string | null>(null);
  const [latestSupportByOfferingId, setLatestSupportByOfferingId] = useState<Record<string, string | null>>({});
  const [monitoringOfferingId, setMonitoringOfferingId] = useState<string | null>(null);
  const [monitoringParticipants, setMonitoringParticipants] = useState<SalesTrialMonitoringParticipant[]>([]);
  const [monitoringObservation, setMonitoringObservation] = useState<SalesTrialMonitoringObservation | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    itemId: "",
    start: "",
    end: "",
    noEndDate: false,
    timeZone: "UTC",
    salesProEmail: "",
  });

  const syncDateTimeField = useCallback(
    (field: "start" | "end", value: string) => {
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const getDraftPayload = useCallback((): DraftPayload => {
    const currentForm = formRef.current;
    const fieldValue = (name: DraftFormField): string => {
      const field = currentForm?.elements.namedItem(name);
      return field && "value" in field ? field.value : form[name];
    };
    return {
      title: fieldValue("title"),
      description: fieldValue("description"),
      itemId: fieldValue("itemId"),
      start: fieldValue("start"),
      end: form.noEndDate ? null : fieldValue("end"),
      noEndDate: form.noEndDate,
      timeZone: fieldValue("timeZone"),
      salesProEmail: fieldValue("salesProEmail"),
    };
  }, [form]);

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
    setMessageCorrelationId(null);
    const payload = getDraftPayload();
    setForm((current) => ({
      ...current,
      ...payload,
      end: payload.end ?? "",
    }));
    const response = await fetchAdmin("/api/sales/trial-offerings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessageTone("error");
      setMessage(body.error ?? "Could not create Trial Offering.");
      setMessageCorrelationId(null);
      return;
    }
    setForm({
      title: "",
      description: "",
      itemId: "",
      start: "",
      end: "",
      noEndDate: false,
      timeZone: "UTC",
      salesProEmail: "",
    });
    await loadOfferings();
    setMessageTone("success");
    setMessage("Trial Offering draft saved.");
    setMessageCorrelationId(null);
  }

  async function lifecycle(id: string, action: "publish" | "end") {
    setMessage(null);
    setMessageCorrelationId(null);
    try {
      const response = await fetchAdmin(`/api/sales/trial-offerings/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
      });
      const body = (await response.json()) as { error?: string; correlationId?: string; offering?: Offering };
      if (!response.ok) {
        const returnedOffering = body.offering;
        if (returnedOffering) {
          setOfferings((current) => current.map((offering) => offering.id === returnedOffering.id ? returnedOffering : offering));
          setLatestSupportByOfferingId((current) => ({
            ...current,
            [returnedOffering.id]: body.correlationId ?? current[returnedOffering.id] ?? null,
          }));
        }
        const duplicatePersistedWarning = returnedOffering?.attentionReason === (body.error ?? null);
        setMessageTone("error");
        setMessage(duplicatePersistedWarning ? null : body.error ?? `Could not ${action} Trial Offering.`);
        setMessageCorrelationId(duplicatePersistedWarning ? null : body.correlationId ?? null);
        return;
      }
      await loadOfferings();
      setMessageTone("success");
      setMessage(action === "publish" ? "Trial Offering published." : "Trial Offering ended.");
      setMessageCorrelationId(null);
    } catch (error) {
      if (isAdminSessionExpiredError(error)) return;
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : `Could not ${action} Trial Offering.`);
    }
  }

  function openSupport(intent: Omit<NavigationIntent, "tab">) {
    onNavigate?.({ tab: "support", ...intent });
  }

  async function toggleMonitoring(id: string) {
    if (monitoringOfferingId === id) {
      setMonitoringOfferingId(null);
      setMonitoringParticipants([]);
      setMonitoringObservation(null);
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
      const body = (await response.json()) as SalesTrialOfferingMonitoringResponseBody & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not load participant monitoring.");
      }
      setMonitoringParticipants([...(body.participants ?? [])]);
      setMonitoringObservation(body.observation ?? null);
    } catch (error) {
      setMonitoringParticipants([]);
      setMonitoringObservation(null);
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
        <form ref={formRef} style={{ display: "grid", gap: "1rem" }} onSubmit={(event) => { event.preventDefault(); void createDraft(); }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>Title<input name="title" style={controlStyle} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>Description<textarea name="description" style={{ ...controlStyle, minHeight: "5.5rem", resize: "vertical" as const }} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>Item<select name="itemId" style={controlStyle} value={form.itemId} onChange={(event) => setForm((current) => ({ ...current, itemId: event.target.value }))}><option value="">Select an Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div aria-label="Trial window settings" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.9rem", alignItems: "start" }}>
            <label style={{ display: "grid", gap: "0.35rem", alignContent: "start" }}>Start<input name="start" style={controlStyle} type="datetime-local" value={form.start} onInput={(event) => syncDateTimeField("start", event.currentTarget.value)} onChange={(event) => syncDateTimeField("start", event.target.value)} /></label>
            <div style={{ display: "grid", gap: "0.55rem", alignContent: "start" }}>
              <label style={{ display: "grid", gap: "0.35rem", alignContent: "start" }}>End<input aria-label="End" name="end" style={form.noEndDate ? { ...controlStyle, ...disabledControlStyle } : controlStyle} type="datetime-local" value={form.end} disabled={form.noEndDate} onInput={(event) => syncDateTimeField("end", event.currentTarget.value)} onChange={(event) => syncDateTimeField("end", event.target.value)} /></label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", minHeight: "2.5rem" }}>
                <input
                  aria-label="No end date"
                  type="checkbox"
                  checked={form.noEndDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      noEndDate: event.target.checked,
                      end: event.target.checked ? "" : current.end,
                    }))
                  }
                />
                No end date
              </label>
            </div>
            <label style={{ display: "grid", gap: "0.35rem", alignContent: "start" }}>Time zone<input name="timeZone" style={controlStyle} list="trial-offering-timezones" value={form.timeZone} onChange={(event) => setForm((current) => ({ ...current, timeZone: event.target.value }))} /><datalist id="trial-offering-timezones">{timezones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</datalist></label>
            <label style={{ display: "grid", gap: "0.35rem", alignContent: "start" }}>Sales Pro<select name="salesProEmail" style={controlStyle} value={form.salesProEmail} onChange={(event) => setForm((current) => ({ ...current, salesProEmail: event.target.value }))}><option value="">Select an active Project member</option>{members.map((member) => <option key={member.email} value={member.email}>{member.displayName} ({member.email})</option>)}</select></label>
          </div>
          <button type="submit" style={primaryButtonStyle}>Save draft</button>
        </form>
        {message ? <div role={messageTone === "error" ? "alert" : "status"} style={{ ...(messageTone === "error" ? alertPanelStyle.danger : alertPanelStyle.success), display: "grid", gap: "0.55rem" }}><p style={{ margin: 0 }}>{message}</p>{messageCorrelationId ? <button type="button" style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer", padding: 0, justifySelf: "start" }} onClick={() => openSupport({ correlationId: messageCorrelationId })}>{`Open support diagnostics (${messageCorrelationId})`}</button> : null}</div> : null}
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
          <p style={{ margin: 0 }}>{offering.start} to {offering.end ?? "Open-ended"} ({offering.timeZone})</p>
          <p style={{ margin: 0 }}>Sales Pro: {offering.salesProDisplayName ?? offering.salesProEmail}</p>
          {offering.status === "ending" ? <div style={mutedPanelStyle}>
            <strong>Ending</strong>
            <p style={{ margin: "0.35rem 0 0" }}>CloudShare access is scheduled to remain available until {offering.endingCalculatedEnd ?? offering.end ?? "the next successful reconciliation"} ({offering.timeZone}).</p>
            <p style={{ margin: "0.35rem 0 0", color: colors.textMuted }}>Last reconciled: {offering.endingLastReconciledAt ?? "Pending"}</p>
          </div> : null}
          {offering.attentionReason ? <div role="alert" style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.55rem" }}><p style={{ margin: 0 }}>{offering.attentionReason}</p><button type="button" style={{ border: 0, background: "transparent", color: colors.info, textDecoration: "underline", cursor: "pointer", padding: 0, justifySelf: "start" }} onClick={() => openSupport(latestSupportByOfferingId[offering.id] ? { correlationId: latestSupportByOfferingId[offering.id] } : { source: "sales-trial-offerings", subjectId: offering.id })}>{latestSupportByOfferingId[offering.id] ? `Open support diagnostics (${latestSupportByOfferingId[offering.id]})` : "Open support diagnostics"}</button></div> : null}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <button type="button" style={offering.status !== "draft" ? { ...primaryButtonStyle, ...disabledButtonStyle } : primaryButtonStyle} disabled={offering.status !== "draft"} onClick={() => void lifecycle(offering.id, "publish")}>Publish</button>
            <button type="button" style={offering.status !== "published" ? { ...secondaryButtonStyle, ...disabledButtonStyle } : secondaryButtonStyle} disabled={offering.status !== "published"} onClick={() => { if (window.confirm("End this Trial Offering now and unpublish it from the portal?")) void lifecycle(offering.id, "end"); }}>End trial</button>
            {offering.status === "published" || offering.status === "ending" || offering.status === "ended" || offering.status === "unpublished" ? <button type="button" style={secondaryButtonStyle} onClick={() => void toggleMonitoring(offering.id)}>{monitoringOfferingId === offering.id ? "Hide monitoring" : "Open monitoring"}</button> : null}
          </div>
          {monitoringOfferingId === offering.id ? <section aria-label="Participant monitoring" style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem", overflowX: "auto", width: "100%" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Participant monitoring</strong>
              <span style={{ color: "#52606d" }}>CloudShare visibility derived from the reconciled Trial enrollment roster.</span>
              {monitoringObservation?.warning ? <span style={{ color: "#52606d" }}>{monitoringObservation.warning}</span> : null}
              {monitoringObservation?.source ? <span style={{ color: "#52606d" }}>{`Observed from ${monitoringObservation.source}${monitoringObservation.observedAt ? ` · ${monitoringObservation.observedAt}` : ""}`}</span> : null}
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
