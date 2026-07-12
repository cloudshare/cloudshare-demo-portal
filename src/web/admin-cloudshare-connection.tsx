"use client";

import React, { useEffect, useState } from "react";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
import { buildWebhookCallbackUrl } from "./admin-cloudshare-connection-state";
import {
  createCorrelationDiagnosticsNavigationIntent,
  type AdminNavigationIntent,
} from "./admin-shell-route";
import { alertPanelStyle, mutedPanelStyle } from "./card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";

interface ConnectionState {
  readonly hasConnection: boolean;
  readonly connectedAt: string | null;
  readonly verifiedAt: string | null;
  readonly webhookPath: string | null;
}

interface ConnectionErrorState {
  readonly message: string;
}

function formatUtcTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function CorrelationDiagnosticsLink(props: {
  readonly correlationId: string;
  readonly getNavigationHref?: (intent: AdminNavigationIntent) => string;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
}) {
  const navigation = createCorrelationDiagnosticsNavigationIntent(props.correlationId);

  return (
    <a
      href={props.getNavigationHref?.(navigation)}
      onClick={(event) => {
        if (!props.onNavigate) return;
        event.preventDefault();
        props.onNavigate(navigation);
      }}
      style={{ color: colors.info, fontFamily: "monospace", fontWeight: 700, overflowWrap: "anywhere" }}
    >
      {props.correlationId}
    </a>
  );
}

export function CloudShareConnectionTestWarning(props: {
  readonly warning: string;
  readonly correlationId?: string | null;
  readonly getNavigationHref?: (intent: AdminNavigationIntent) => string;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
}) {
  return (
    <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.4rem" }}>
      <p style={{ margin: 0 }}>{props.warning}</p>
      {props.correlationId ? (
        <p style={{ margin: 0, fontSize: "0.85rem" }}>
          Open <strong>Support Diagnostics</strong> filtered by correlation ID{" "}
          <CorrelationDiagnosticsLink
            correlationId={props.correlationId}
            getNavigationHref={props.getNavigationHref}
            onNavigate={props.onNavigate}
          />
          .
        </p>
      ) : null}
    </div>
  );
}

export function CloudShareConnectionFeature(props: {
  readonly active?: boolean;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly getNavigationHref: (intent: AdminNavigationIntent) => string;
  readonly onNavigate: (intent: AdminNavigationIntent) => void;
}) {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookPublicBaseUrl, setWebhookPublicBaseUrl] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<ConnectionErrorState | null>(null);
  const [connectionCorrelationId, setConnectionCorrelationId] = useState<string | null>(null);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadConnection() {
    try {
      const response = await props.fetchAdmin("/api/admin/cloudshare");
      const data = (await response.json()) as ConnectionState & { error?: string };
      if (response.ok) {
        setConnection({
          hasConnection: data.hasConnection,
          connectedAt: data.connectedAt,
          verifiedAt: data.verifiedAt,
          webhookPath: data.webhookPath,
        });
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
    }
  }

  useEffect(() => {
    void loadConnection();
    // The authenticated adapter is stable for the lifetime of the admin shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (props.active === false) {
      setConnectionError(null);
    }
  }, [props.active]);

  async function saveConnection() {
    setLoading(true);
    setConnectionError(null);
    setConnectionMessage(null);
    setConnectionCorrelationId(null);
    setConnectionWarning(null);
    const trimmedApiId = apiId.trim();
    const trimmedApiKey = apiKey.trim();
    const trimmedWebhookSecret = webhookSecret.trim();
    const hasSavedConnection = connection?.hasConnection ?? false;
    if (!hasSavedConnection && (!trimmedApiId || !trimmedApiKey || !trimmedWebhookSecret)) {
      setConnectionError({
        message: "API ID, API Key, and Webhook Secret are required to save the first CloudShare Connection.",
      });
      setLoading(false);
      return;
    }
    if (hasSavedConnection && !trimmedApiId && !trimmedApiKey && !trimmedWebhookSecret) {
      setConnectionError({
        message: "Enter at least one field to update the saved CloudShare Connection.",
      });
      setLoading(false);
      return;
    }
    try {
      const response = await props.fetchAdmin("/api/admin/cloudshare", {
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
        setConnectionError({ message: data.error ?? "Failed to save CloudShare Connection" });
        return;
      }
      setConnection({
        hasConnection: data.hasConnection,
        connectedAt: data.connectedAt,
        verifiedAt: data.verifiedAt,
        webhookPath: data.webhookPath,
      });
      setConnectionMessage("CloudShare Connection saved.");
      setApiId("");
      setApiKey("");
      setWebhookSecret("");
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setConnectionError({ message: "Failed to save CloudShare Connection" });
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    setLoading(true);
    setConnectionError(null);
    setConnectionMessage(null);
    setConnectionCorrelationId(null);
    setConnectionWarning(null);
    try {
      const response = await props.fetchAdmin("/api/admin/cloudshare/test", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        correlationId?: string;
      };
      if (!response.ok) {
        setConnectionWarning(data.error ?? "CloudShare connection test failed. Open Support Diagnostics with the correlation ID for the primary investigation view.");
        setConnectionCorrelationId(data.correlationId ?? null);
        return;
      }
      await loadConnection();
      setConnectionMessage(`CloudShare responded with ${data.message}.`);
      setConnectionCorrelationId(data.correlationId ?? null);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setConnectionWarning("CloudShare connection test failed. Open Support Diagnostics for more detail.");
    } finally {
      setLoading(false);
    }
  }

  if (props.active === false) {
    return null;
  }

  const hasSavedConnection = connection?.hasConnection ?? false;
  const isVerified = connection?.verifiedAt !== null && connection?.verifiedAt !== undefined;
  const connectionStatusLabel = isVerified
    ? "Verified"
    : hasSavedConnection
      ? "Saved, not yet verified"
      : "No CloudShare Connection saved yet";
  const storedSecretPlaceholder = hasSavedConnection ? "********" : "";
  const webhookCallbackUrl = buildWebhookCallbackUrl(webhookPublicBaseUrl, connection?.webhookPath);

  return (
    <>
      {connectionError ? (
        <div style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <p style={{ margin: 0 }}>{connectionError.message}</p>
            <button type="button" onClick={() => setConnectionError(null)} style={{ padding: "0.25rem 0.55rem" }}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <section style={{ display: "grid", gap: "1rem" }}>
        <div style={mutedPanelStyle}>
          <p style={{ margin: 0 }}>
            Status: <strong>{connectionStatusLabel}</strong>
          </p>
          {connection?.connectedAt ? (
            <p style={{ marginBottom: 0 }}>Saved (UTC): {formatUtcTimestamp(connection.connectedAt)}</p>
          ) : null}
          {connection?.verifiedAt ? (
            <p style={{ marginBottom: 0 }}>Verified (UTC): {formatUtcTimestamp(connection.verifiedAt)}</p>
          ) : null}
          {hasSavedConnection && !isVerified ? (
            <p style={{ marginBottom: 0, color: "#555" }}>
              Connection details are stored. Run <strong>Test connection</strong> to verify them against CloudShare.
            </p>
          ) : null}
        </div>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span>API ID</span>
          <input
            value={apiId}
            onChange={(event) => setApiId(event.target.value)}
            placeholder={hasSavedConnection ? "stored value present" : ""}
            style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
          />
          {hasSavedConnection && !apiId ? (
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              An API ID is stored. Enter a new value only to replace it.
            </span>
          ) : null}
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
          {hasSavedConnection && !apiKey ? (
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              A stored API Key is present. Enter a new value only to replace it.
            </span>
          ) : null}
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
          {hasSavedConnection && !webhookSecret ? (
            <span style={{ color: "#666", fontSize: "0.85rem" }}>
              A stored Webhook Secret is present. Enter a new value only to replace it.
            </span>
          ) : null}
        </label>
        {hasSavedConnection ? (
          <div style={{ ...alertPanelStyle.info, display: "grid", gap: "0.75rem" }}>
            <div>
              <strong>CloudShare webhook callback</strong>
              <p style={{ margin: "0.35rem 0 0", color: "#45556c" }}>
                Register this callback manually in CloudShare until v3 webhook auto-registration is live-verified.
                Select only the environment lifecycle events.
              </p>
            </div>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Public portal base URL</span>
              <input
                value={webhookPublicBaseUrl}
                onChange={(event) => setWebhookPublicBaseUrl(event.target.value)}
                placeholder="https://<current-public-base-url>"
                style={{ padding: "0.7rem", border: "1px solid #aac4ea", borderRadius: "6px" }}
              />
            </label>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <span>Portal webhook path</span>
              <code style={{ display: "block", overflowWrap: "anywhere", background: "#fff", padding: "0.7rem", borderRadius: "6px", border: "1px solid #d8e5f8" }}>
                {connection?.webhookPath ?? "Save a CloudShare Connection to generate a path."}
              </code>
            </div>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <span>Full CloudShare callback URL</span>
              <code style={{ display: "block", overflowWrap: "anywhere", background: "#fff", padding: "0.7rem", borderRadius: "6px", border: "1px solid #d8e5f8" }}>
                {webhookCallbackUrl ?? "Enter the public base URL above."}
              </code>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                disabled={!webhookCallbackUrl}
                onClick={() => {
                  if (webhookCallbackUrl) {
                    void navigator.clipboard?.writeText(webhookCallbackUrl);
                    setConnectionMessage("Webhook callback URL copied.");
                  }
                }}
                style={{ padding: "0.55rem 0.9rem" }}
              >
                Copy callback URL
              </button>
              <span style={{ color: "#45556c", fontSize: "0.9rem" }}>
                Auto-create in CloudShare is deferred until the v3 create request/response is verified.
              </span>
            </div>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={saveConnection} disabled={loading} style={primaryButtonStyle}>
            {loading ? "Saving..." : "Save CloudShare Connection"}
          </button>
          <button onClick={testConnection} disabled={loading || !connection?.hasConnection} style={secondaryButtonStyle}>
            {loading ? "Testing..." : "Test connection"}
          </button>
        </div>
        {connectionWarning ? (
          <CloudShareConnectionTestWarning
            warning={connectionWarning}
            correlationId={connectionCorrelationId}
            getNavigationHref={props.getNavigationHref}
            onNavigate={props.onNavigate}
          />
        ) : null}
        {connectionMessage ? <p style={{ color: "#0a7a28", margin: 0 }}>{connectionMessage}</p> : null}
      </section>
    </>
  );
}
