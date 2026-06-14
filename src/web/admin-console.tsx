"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

interface SupportLogRecord {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown>;
}

interface ConnectionDiagnostic {
  operation: string;
  integrationSurface: string;
  integrationLabel?: string;
  method: string;
  path: string;
  requestUrl?: string;
  failureMode: string;
  responseStatus?: number;
  requestHeaders?: Record<string, unknown>;
  responseHeaders?: Record<string, unknown>;
  responseBody?: unknown;
  cause?: string;
  network?: Record<string, unknown>;
  tls?: Record<string, unknown>;
}

interface SyncResult {
  synced: number;
  byType: Record<string, Array<{ name: string; cloudshareId: string; syncedAt: string }>>;
}

type Tab = "connection" | "audit" | "events" | "support" | "resources";

function formatUtcTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function readStringField(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(
  fields: Record<string, unknown>,
  key: string,
): number | null {
  const value = fields[key];
  return typeof value === "number" ? value : null;
}

function formatSupportValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function AdminConsole({ email }: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("connection");
  const [examAttemptFilter, setExamAttemptFilter] = useState("");
  const [auditRecords, setAuditRecords] = useState<AuditRecord[] | null>(null);
  const [eventRecords, setEventRecords] = useState<EventLogRecord[] | null>(null);
  const [supportRecords, setSupportRecords] = useState<SupportLogRecord[] | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connectionDiagnostic, setConnectionDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [connectionCorrelationId, setConnectionCorrelationId] = useState<string | null>(null);
  const [connectionOccurredAt, setConnectionOccurredAt] = useState<string | null>(null);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
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
    setConnectionDiagnostic(null);
    setConnectionCorrelationId(null);
    setConnectionOccurredAt(null);
    setConnectionWarning(null);
    const trimmedApiId = apiId.trim();
    const trimmedApiKey = apiKey.trim();
    const trimmedWebhookSecret = webhookSecret.trim();
    if (!hasSavedConnection && (!trimmedApiId || !trimmedApiKey || !trimmedWebhookSecret)) {
      setError("API ID, API Key, and Webhook Secret are required to save the first CloudShare Connection.");
      setLoading(false);
      return;
    }
    if (hasSavedConnection && !trimmedApiId && !trimmedApiKey && !trimmedWebhookSecret) {
      setError("Enter at least one field to update the saved CloudShare Connection.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: trimmedApiId,
          apiKey: trimmedApiKey,
          webhookSecret: trimmedWebhookSecret,
        }),
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
      setApiId("");
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
    setConnectionDiagnostic(null);
    setConnectionCorrelationId(null);
    setConnectionOccurredAt(null);
    setConnectionWarning(null);
    try {
      const response = await fetch("/api/admin/cloudshare/test", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        verifiedAt?: string;
        correlationId?: string;
        occurredAt?: string;
        diagnostic?: ConnectionDiagnostic | null;
      };
      if (!response.ok) {
        setError(data.error ?? "CloudShare connection test failed");
        setConnectionWarning("CloudShare connection test failed. Check the warning details and support log.");
        setConnectionDiagnostic(data.diagnostic ?? null);
        setConnectionCorrelationId(data.correlationId ?? null);
        setConnectionOccurredAt(data.occurredAt ?? null);
        void loadSupportLog(true);
        return;
      }
      await loadConnection();
      setConnectionMessage(`CloudShare responded with ${data.message}.`);
      setConnectionCorrelationId(data.correlationId ?? null);
      setConnectionOccurredAt(data.occurredAt ?? null);
    } catch {
      setError("CloudShare connection test failed");
      setConnectionWarning("CloudShare connection test failed. Check the support log for more detail.");
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

  async function loadSupportLog(background = false) {
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch("/api/admin/support-log?limit=200");
      const data = await res.json() as { records?: SupportLogRecord[]; error?: string };
      if (!res.ok) {
        if (!background) {
          setError(data.error ?? "Failed to load support log");
        }
        return;
      }
      setSupportRecords(data.records ?? []);
    } catch {
      if (!background) {
        setError("Failed to load support log");
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  function onLoadSupportLog() {
    void loadSupportLog();
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

  async function logout() {
    setLoading(true);
    setError(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const hasSavedConnection = connection?.hasConnection ?? false;
  const isVerified = connection?.verifiedAt !== null && connection?.verifiedAt !== undefined;
  const connectionStatusLabel = isVerified
    ? "Verified"
    : hasSavedConnection
      ? "Saved, not yet verified"
      : "No CloudShare Connection saved yet";
  const storedSecretPlaceholder = hasSavedConnection ? "********" : "";

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "0.35rem" }}>Certalis Admin Console</h1>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#555" }}>Signed in as {email}</p>
        <button onClick={logout} disabled={loading} style={{ padding: "0.55rem 0.9rem" }}>
          Log out
        </button>
      </div>

      <nav style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {(["connection", "audit", "events", "support", "resources"] as Tab[]).map((t) => (
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
                  : t === "support"
                    ? "Support Log"
                  : "Resources"}
          </button>
        ))}
      </nav>

      {error && (
        <div style={{ color: "#b00020", background: "#fff0f0", padding: "0.75rem", borderRadius: "6px", display: "grid", gap: "0.5rem" }}>
          <p style={{ margin: 0 }}>{error}</p>
          {(connectionDiagnostic || connectionCorrelationId) && (
            <div style={{ color: "#5f2120", fontSize: "0.9rem", display: "grid", gap: "0.25rem" }}>
              {connectionOccurredAt && (
                <div>Recorded at (UTC): {formatUtcTimestamp(connectionOccurredAt)}</div>
              )}
              {connectionDiagnostic?.operation && <div>Operation: {connectionDiagnostic.operation}</div>}
              {connectionDiagnostic?.integrationLabel && (
                <div>CloudShare endpoint: {connectionDiagnostic.integrationLabel}</div>
              )}
              {connectionDiagnostic?.integrationSurface && (
                <div>Internal diagnostic key: {connectionDiagnostic.integrationSurface}</div>
              )}
              {(connectionDiagnostic?.method || connectionDiagnostic?.path) && (
                <div>
                  Request: {connectionDiagnostic?.method ?? "?"} {connectionDiagnostic?.path ?? "?"}
                </div>
              )}
              {connectionDiagnostic?.requestUrl && (
                <div>Request URL: {connectionDiagnostic.requestUrl}</div>
              )}
              {connectionDiagnostic?.failureMode && <div>Failure mode: {connectionDiagnostic.failureMode}</div>}
              {typeof connectionDiagnostic?.responseStatus === "number" && (
                <div>Returned status: {connectionDiagnostic.responseStatus}</div>
              )}
              {connectionDiagnostic?.cause && <div>Cause: {connectionDiagnostic.cause}</div>}
              {connectionDiagnostic?.requestHeaders !== undefined && (
                <div>
                  Request headers:
                  <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                    {formatSupportValue(connectionDiagnostic.requestHeaders)}
                  </pre>
                </div>
              )}
              {connectionDiagnostic?.responseHeaders !== undefined && (
                <div>
                  Response headers:
                  <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                    {formatSupportValue(connectionDiagnostic.responseHeaders)}
                  </pre>
                </div>
              )}
              {connectionDiagnostic?.responseBody !== undefined && (
                <div>
                  Response body:
                  <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                    {formatSupportValue(connectionDiagnostic.responseBody)}
                  </pre>
                </div>
              )}
              {connectionDiagnostic?.network !== undefined && (
                <div>
                  Network:
                  <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                    {formatSupportValue(connectionDiagnostic.network)}
                  </pre>
                </div>
              )}
              {connectionDiagnostic?.tls !== undefined && (
                <div>
                  TLS:
                  <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                    {formatSupportValue(connectionDiagnostic.tls)}
                  </pre>
                </div>
              )}
              {connectionCorrelationId && <div>Correlation ID: {connectionCorrelationId}</div>}
            </div>
          )}
        </div>
      )}

      {tab === "connection" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px" }}>
            <p style={{ margin: 0 }}>
              Status:{" "}
              <strong>{connectionStatusLabel}</strong>
            </p>
            {connection?.connectedAt && (
              <p style={{ marginBottom: 0 }}>Saved (UTC): {formatUtcTimestamp(connection.connectedAt)}</p>
            )}
            {connection?.verifiedAt && (
              <p style={{ marginBottom: 0 }}>Verified (UTC): {formatUtcTimestamp(connection.verifiedAt)}</p>
            )}
            {hasSavedConnection && !isVerified && (
              <p style={{ marginBottom: 0, color: "#555" }}>
                Connection details are stored. Run <strong>Test connection</strong> to verify them against CloudShare.
              </p>
            )}
          </div>
          {connectionWarning && (
            <div style={{ color: "#7a4b00", background: "#fff7e6", padding: "0.75rem", borderRadius: "6px", display: "grid", gap: "0.4rem" }}>
              <p style={{ margin: 0 }}>{connectionWarning}</p>
              {connectionCorrelationId && (
                <p style={{ margin: 0, fontSize: "0.85rem" }}>
                  Correlation ID: <span style={{ fontFamily: "monospace" }}>{connectionCorrelationId}</span>
                </p>
              )}
            </div>
          )}

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>API ID</span>
            <input
              value={apiId}
              onChange={(event) => setApiId(event.target.value)}
              placeholder={hasSavedConnection ? "stored value present" : ""}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
            {hasSavedConnection && !apiId && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                An API ID is stored. Enter a new value only to replace it.
              </span>
            )}
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={storedSecretPlaceholder}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
            {hasSavedConnection && !apiKey && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                A stored API Key is present. Enter a new value only to replace it.
              </span>
            )}
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Webhook Secret</span>
            <input
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder={storedSecretPlaceholder}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
            {hasSavedConnection && !webhookSecret && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                A stored Webhook Secret is present. Enter a new value only to replace it.
              </span>
            )}
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
                      {formatUtcTimestamp(r.occurredAt)}
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
                      {formatUtcTimestamp(e.occurredAt)}
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

      {tab === "support" && (
        <section>
          <p style={{ color: "#555", marginTop: 0 }}>
            Structured server logs. All timestamps are ISO 8601 in UTC. Secure values stay redacted.
          </p>
          <button onClick={onLoadSupportLog} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
            {loading ? "Loading..." : "Load Support Log"}
          </button>
          {supportRecords && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Time (UTC)", "Level", "Operation", "Request", "Result", "Correlation ID", "Details"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supportRecords.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "0.5rem", color: "#666" }}>
                      No support log records
                    </td>
                  </tr>
                )}
                {supportRecords.map((record, index) => {
                  const operation = readStringField(record.fields, "operation") ?? record.message;
                  const method = readStringField(record.fields, "method");
                  const path = readStringField(record.fields, "path");
                  const responseStatus = readNumberField(record.fields, "responseStatus");
                  const failureMode = readStringField(record.fields, "failureMode");
                  const correlationId = readStringField(record.fields, "correlationId");
                  const integrationSurface = readStringField(record.fields, "integrationSurface");
                  const host = readStringField(record.fields, "host");
                  const requestHeaders = record.fields.requestHeaders;
                  const responseHeaders = record.fields.responseHeaders;
                  const responseBody = record.fields.responseBody;
                  const network = record.fields.network;
                  const tls = record.fields.tls;
                  const cause = readStringField(record.fields, "cause");
                  const errorMessage = readStringField(record.fields, "error");
                  const verifiedAt = readStringField(record.fields, "verifiedAt");

                  return (
                    <tr key={`${record.timestamp}-${record.message}-${index}`} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                      <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                        {formatUtcTimestamp(record.timestamp)}
                      </td>
                      <td style={{ padding: "0.4rem", textTransform: "uppercase" }}>{record.level}</td>
                      <td style={{ padding: "0.4rem" }}>
                        <div>{operation}</div>
                        {integrationSurface && (
                          <div style={{ color: "#666", fontSize: "0.75rem" }}>{integrationSurface}</div>
                        )}
                      </td>
                      <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>
                        {method ?? "?"} {host ? `${host}${path ?? ""}` : (path ?? "?")}
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        {typeof responseStatus === "number" ? `HTTP ${responseStatus}` : failureMode ?? record.message}
                        {verifiedAt && (
                          <div style={{ color: "#666", fontSize: "0.75rem" }}>
                            Verified at {formatUtcTimestamp(verifiedAt)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.4rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                        {correlationId ?? "-"}
                      </td>
                      <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#444" }}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <div>
                            <strong>Message:</strong> {record.message}
                          </div>
                          {errorMessage && (
                            <div>
                              <strong>Error:</strong> {errorMessage}
                            </div>
                          )}
                          {cause && (
                            <div>
                              <strong>Cause:</strong> {cause}
                            </div>
                          )}
                          {requestHeaders !== undefined && (
                            <div>
                              <strong>Request headers:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(requestHeaders)}
                              </pre>
                            </div>
                          )}
                          {responseBody !== undefined && (
                            <div>
                              <strong>Response body:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(responseBody)}
                              </pre>
                            </div>
                          )}
                          {responseHeaders !== undefined && (
                            <div>
                              <strong>Response headers:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(responseHeaders)}
                              </pre>
                            </div>
                          )}
                          {network !== undefined && (
                            <div>
                              <strong>Network:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(network)}
                              </pre>
                            </div>
                          )}
                          {tls !== undefined && (
                            <div>
                              <strong>TLS:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(tls)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
                            {formatUtcTimestamp(item.syncedAt)}
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
