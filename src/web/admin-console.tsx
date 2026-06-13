"use client";

import { useEffect, useState } from "react";

interface AdminConsoleProps {
  readonly email: string;
}

interface ConnectionState {
  hasConnection: boolean;
  connectedAt: string | null;
  verifiedAt: string | null;
}

interface AuditRecord {
  id: string;
  examAttemptId: string;
  candidateId?: string;
  action: string;
  outcome: "success" | "failure";
  details?: Record<string, unknown>;
  error?: string;
  occurredAt: string;
}

interface EventLogRecord {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface SyncResult {
  synced: number;
  byType: Record<string, Array<{ name: string; cloudshareId: string; syncedAt: string }>>;
}

type Tab = "connection" | "audit" | "events" | "resources";

export function AdminConsole({ email }: AdminConsoleProps) {
  const [tab, setTab] = useState<Tab>("connection");
  const [examAttemptFilter, setExamAttemptFilter] = useState("");
  const [auditRecords, setAuditRecords] = useState<AuditRecord[] | null>(null);
  const [eventRecords, setEventRecords] = useState<EventLogRecord[] | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadConnection();
  }, []);

  async function loadConnection() {
    const response = await fetch("/api/admin/cloudshare");
    const data = (await response.json()) as ConnectionState & { error?: string };
    if (response.ok) {
      setConnection({
        hasConnection: data.hasConnection,
        connectedAt: data.connectedAt,
        verifiedAt: data.verifiedAt,
      });
    }
  }

  async function saveConnection() {
    setLoading(true);
    setError(null);
    setConnectionMessage(null);
    try {
      const response = await fetch("/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiId, apiKey, webhookSecret }),
      });
      const data = (await response.json()) as ConnectionState & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to save CloudShare Connection");
        return;
      }
      setConnection({
        hasConnection: data.hasConnection,
        connectedAt: data.connectedAt,
        verifiedAt: data.verifiedAt,
      });
      setConnectionMessage("CloudShare Connection saved.");
      setApiKey("");
      setWebhookSecret("");
    } catch {
      setError("Failed to save CloudShare Connection");
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    setLoading(true);
    setError(null);
    setConnectionMessage(null);
    try {
      const response = await fetch("/api/admin/cloudshare/test", { method: "POST" });
      const data = (await response.json()) as { error?: string; message?: string; verifiedAt?: string };
      if (!response.ok) {
        setError(data.error ?? "CloudShare connection test failed");
        return;
      }
      await loadConnection();
      setConnectionMessage(`CloudShare responded with ${data.message}.`);
    } catch {
      setError("CloudShare connection test failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const qs = examAttemptFilter.trim()
        ? `?examAttemptId=${encodeURIComponent(examAttemptFilter.trim())}`
        : "";
      const res = await fetch(`/api/admin/audit${qs}`);
      const data = await res.json() as { records?: AuditRecord[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load audit trail");
        return;
      }
      setAuditRecords(data.records ?? []);
    } catch {
      setError("Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events?limit=100");
      const data = await res.json() as { events?: EventLogRecord[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load event log");
        return;
      }
      setEventRecords(data.events ?? []);
    } catch {
      setError("Failed to load event log");
    } finally {
      setLoading(false);
    }
  }

  async function syncResources() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sync-resources", { method: "POST" });
      const data = await res.json() as SyncResult | { error: string };
      if ("error" in data) {
        setError(data.error);
      } else {
        setSyncResult(data);
      }
    } catch {
      setError("Sync request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Certalis Admin Console</h1>
      <p style={{ marginTop: 0, color: "#555" }}>Signed in as {email}</p>

      <nav style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {(["connection", "audit", "events", "resources"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "0.5rem 0.9rem",
              background: tab === t ? "#111827" : "#eee",
              color: tab === t ? "#fff" : "#111",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {t === "connection"
              ? "Connect CloudShare"
              : t === "audit"
                ? "Audit Trail"
                : t === "events"
                  ? "Event Log"
                  : "Resources"}
          </button>
        ))}
      </nav>

      {error && (
        <p style={{ color: "#b00020", background: "#fff0f0", padding: "0.75rem", borderRadius: "6px" }}>
          {error}
        </p>
      )}

      {tab === "connection" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px" }}>
            <p style={{ margin: 0 }}>
              Status:{" "}
              <strong>{connection?.hasConnection ? "Connected" : "No CloudShare Connection saved yet"}</strong>
            </p>
            {connection?.connectedAt && (
              <p style={{ marginBottom: 0 }}>Saved: {new Date(connection.connectedAt).toLocaleString()}</p>
            )}
            {connection?.verifiedAt && (
              <p style={{ marginBottom: 0 }}>Verified: {new Date(connection.verifiedAt).toLocaleString()}</p>
            )}
          </div>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>API ID</span>
            <input
              value={apiId}
              onChange={(event) => setApiId(event.target.value)}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Webhook Secret</span>
            <input
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
          </label>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button onClick={saveConnection} disabled={loading} style={{ padding: "0.7rem 1rem" }}>
              {loading ? "Saving..." : "Save CloudShare Connection"}
            </button>
            <button onClick={testConnection} disabled={loading || !connection?.hasConnection} style={{ padding: "0.7rem 1rem" }}>
              {loading ? "Testing..." : "Test connection"}
            </button>
          </div>
          {connectionMessage && <p style={{ color: "#0a7a28", margin: 0 }}>{connectionMessage}</p>}
        </section>
      )}

      {tab === "audit" && (
        <section>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <input
              placeholder="Filter by examAttemptId (optional)"
              value={examAttemptFilter}
              onChange={(e) => setExamAttemptFilter(e.target.value)}
              style={{ flex: 1, padding: "0.4rem" }}
            />
            <button onClick={loadAudit} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
          {auditRecords && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Time", "ExamAttempt", "Action", "Outcome", "Details / Error"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditRecords.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0.5rem", color: "#666" }}>
                      No records found
                    </td>
                  </tr>
                )}
                {auditRecords.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                      {new Date(r.occurredAt).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{r.examAttemptId}</td>
                    <td style={{ padding: "0.4rem" }}>{r.action}</td>
                    <td style={{ padding: "0.4rem", color: r.outcome === "success" ? "green" : "red", fontWeight: "bold" }}>
                      {r.outcome}
                    </td>
                    <td style={{ padding: "0.4rem", fontSize: "0.8rem", color: "#444" }}>
                      {r.error ?? (r.details ? JSON.stringify(r.details) : "-")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "events" && (
        <section>
          <button onClick={loadEvents} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
            {loading ? "Loading..." : "Load Event Log"}
          </button>
          {eventRecords && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Time", "Type", "Event ID", "Payload"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {eventRecords.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "0.5rem", color: "#666" }}>
                      No events recorded
                    </td>
                  </tr>
                )}
                {eventRecords.map((e) => (
                  <tr key={e.eventId} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                      {new Date(e.occurredAt).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{e.type}</td>
                    <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#666" }}>{e.eventId}</td>
                    <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#444" }}>
                      <pre style={{ margin: 0 }}>{JSON.stringify(e.payload, null, 0)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "resources" && (
        <section>
          <button onClick={syncResources} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
            {loading ? "Syncing..." : "Sync CloudShare Resources"}
          </button>
          {syncResult && (
            <div>
              <p>
                Synced <strong>{syncResult.synced}</strong> resource(s)
              </p>
              {Object.entries(syncResult.byType).map(([type, items]) => (
                <div key={type} style={{ marginBottom: "1rem" }}>
                  <h3 style={{ margin: "0 0 0.4rem" }}>{type}</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ background: "#f5f5f5" }}>
                        {["Name", "CloudShare ID", "Synced At"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.cloudshareId} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "0.4rem" }}>{item.name}</td>
                          <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{item.cloudshareId}</td>
                          <td style={{ padding: "0.4rem" }}>
                            {new Date(item.syncedAt).toISOString().replace("T", " ").slice(0, 19)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
