"use client";

import React, { useEffect, useState } from "react";

type Item = { id: string; name: string; defaultDurationMinutes: number };
type Timezone = { id: string; name: string };
type Member = { email: string; displayName: string };
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

export function SalesTrialOfferingsAdmin({ email }: { readonly email: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [timezones, setTimezones] = useState<Timezone[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    itemId: "",
    start: "",
    end: "",
    timeZone: "UTC",
    salesProEmail: "",
  });

  async function loadOfferings() {
    const response = await fetch("/api/sales/trial-offerings");
    const body = (await response.json()) as { offerings?: Offering[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Could not load Trial Offerings.");
    setOfferings(body.offerings ?? []);
  }

  useEffect(() => {
    void Promise.all([
      fetch("/api/sales/items").then(async (response) => {
        const body = (await response.json()) as { activeItems?: Item[] };
        setItems(body.activeItems ?? []);
      }),
      fetch("/api/sales/timezones").then(async (response) => {
        const body = (await response.json()) as { timezones?: Timezone[] };
        setTimezones(body.timezones ?? []);
      }),
      loadOfferings(),
    ]).catch((error) => setMessage(error instanceof Error ? error.message : "Load failed."));
  }, []);

  useEffect(() => {
    if (!form.itemId) {
      setMembers([]);
      setForm((current) => ({ ...current, salesProEmail: "" }));
      return;
    }
    void fetch(`/api/sales/enablement-sessions/project-members?itemId=${encodeURIComponent(form.itemId)}`)
      .then(async (response) => {
        const body = (await response.json()) as { members?: Member[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not retrieve active Project members.");
        setMembers(body.members ?? []);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Load failed."));
  }, [form.itemId]);

  async function createDraft() {
    setMessage(null);
    const response = await fetch("/api/sales/trial-offerings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
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
    setMessage("Trial Offering draft saved.");
  }

  async function lifecycle(id: string, action: "publish" | "unpublish") {
    setMessage(null);
    const response = await fetch(`/api/sales/trial-offerings/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? `Could not ${action} Trial Offering.`);
      return;
    }
    await loadOfferings();
    setMessage(action === "publish" ? "Trial Offering published." : "Trial Offering unpublished.");
  }

  return (
    <main style={{ padding: "2rem", display: "grid", gap: "1.5rem", background: "#f8fafc", minHeight: "100vh" }}>
      <section style={{ background: "#ffffff", border: "1px solid #dbe4ee", borderRadius: "12px", padding: "1.5rem", display: "grid", gap: "0.6rem" }}>
        <p style={{ margin: 0, color: "#52606d" }}>Sales admin</p>
        <h1 style={{ margin: 0 }}>Trial Offerings</h1>
        <p style={{ margin: 0, color: "#52606d" }}>
          Publish one shared CloudShare Sales Experience of type <code>trial</code> without adding participants or exposing provider identifiers in the ordinary UI. Signed in as {email}.
        </p>
      </section>
      <section style={{ background: "#ffffff", border: "1px solid #dbe4ee", borderRadius: "12px", padding: "1.5rem", display: "grid", gap: "0.9rem" }}>
        <h2 style={{ margin: 0 }}>Create draft</h2>
        <label style={{ display: "grid", gap: "0.35rem" }}>Title<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Description<textarea rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label style={{ display: "grid", gap: "0.35rem" }}>Item<select value={form.itemId} onChange={(event) => setForm((current) => ({ ...current, itemId: event.target.value }))}><option value="">Select an Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.9rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>Start<input type="datetime-local" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>End<input type="datetime-local" value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} /></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>Time zone<input list="trial-offering-timezones" value={form.timeZone} onChange={(event) => setForm((current) => ({ ...current, timeZone: event.target.value }))} /><datalist id="trial-offering-timezones">{timezones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</datalist></label>
          <label style={{ display: "grid", gap: "0.35rem" }}>Sales Pro<select value={form.salesProEmail} onChange={(event) => setForm((current) => ({ ...current, salesProEmail: event.target.value }))}><option value="">Select an active Project member</option>{members.map((member) => <option key={member.email} value={member.email}>{member.displayName} ({member.email})</option>)}</select></label>
        </div>
        <button type="button" onClick={() => void createDraft()} style={{ justifySelf: "start" }}>Save draft</button>
        {message ? <p role="status" style={{ margin: 0 }}>{message}</p> : null}
      </section>
      <section style={{ background: "#ffffff", border: "1px solid #dbe4ee", borderRadius: "12px", padding: "1.5rem", display: "grid", gap: "0.9rem" }}>
        <h2 style={{ margin: 0 }}>Current Offerings</h2>
        {offerings.length === 0 ? <p style={{ margin: 0 }}>No Trial Offerings yet.</p> : offerings.map((offering) => <article key={offering.id} style={{ border: "1px solid #dbe4ee", borderRadius: "10px", padding: "1rem", display: "grid", gap: "0.4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0 }}>{offering.title}</h3>
              <p style={{ margin: "0.25rem 0 0", color: "#52606d" }}>{offering.description}</p>
            </div>
            <strong>{offering.status}</strong>
          </div>
          <p style={{ margin: 0 }}>{offering.start} to {offering.end} ({offering.timeZone})</p>
          <p style={{ margin: 0 }}>Sales Pro: {offering.salesProDisplayName ?? offering.salesProEmail}</p>
          {offering.attentionReason ? <p style={{ margin: 0, color: "#9a3412" }}>{offering.attentionReason}</p> : null}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <button type="button" disabled={offering.status !== "draft"} onClick={() => void lifecycle(offering.id, "publish")}>Publish</button>
            <button type="button" disabled={offering.status !== "published"} onClick={() => void lifecycle(offering.id, "unpublish")}>Unpublish</button>
          </div>
        </article>)}
      </section>
    </main>
  );
}
