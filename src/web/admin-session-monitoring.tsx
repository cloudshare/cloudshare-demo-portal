"use client";

import React, { useEffect, useState } from "react";
import type { AdminMonitoringView } from "@/domain/admin-monitoring";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
import { buildMonitoringHistoryQueryString, mergeMonitoringHistoryPage } from "./admin-session-monitoring-state";
import {
  createExamAttemptDiagnosticsNavigationIntent,
  type AdminNavigationIntent,
} from "./admin-shell-route";
import { SessionMonitoringPanel } from "./session-monitoring-panel";
import { alertPanelStyle } from "./card-styles";

export interface AdminSessionMonitoringFeatureProps {
  readonly active: boolean;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
}

export function AdminSessionMonitoringFeature({
  active,
  fetchAdmin,
  onNavigate,
}: AdminSessionMonitoringFeatureProps) {
  const [monitoring, setMonitoring] = useState<AdminMonitoringView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMonitoring(historyOffset = 0) {
    setLoading(true);
    setError(null);
    try {
      const query = buildMonitoringHistoryQueryString({ limit: 25, offset: historyOffset });
      const response = await fetchAdmin(`/api/admin/monitoring${query}`);
      const data = await response.json() as { monitoring?: AdminMonitoringView; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to load session monitoring");
        return;
      }
      setMonitoring((current) =>
        data.monitoring ? mergeMonitoringHistoryPage(historyOffset === 0 ? null : current, data.monitoring) : null,
      );
    } catch (caughtError) {
      if (!isAdminSessionExpiredError(caughtError)) setError("Failed to load session monitoring");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (active) void loadMonitoring();
    // fetchAdmin is intentionally a stable shell adapter; reload only on route activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;
  return (
    <section style={{ display: "grid", gap: "1rem" }}>
      {error ? (
        <div role="alert" style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <p style={{ margin: 0 }}>{error}</p>
            <button type="button" onClick={() => setError(null)} style={{ padding: "0.25rem 0.55rem" }}>Dismiss</button>
          </div>
        </div>
      ) : null}
      {monitoring ? (
        monitoring ? (
          <SessionMonitoringPanel
            monitoring={monitoring}
            loading={loading}
            onRefresh={() => void loadMonitoring()}
            onLoadMoreHistory={() => {
              const nextOffset = monitoring.historyPage.nextOffset;
              if (typeof nextOffset === "number") void loadMonitoring(nextOffset);
            }}
            onOpenSupportDiagnostics={(examAttemptId) => onNavigate?.(createExamAttemptDiagnosticsNavigationIntent(examAttemptId))}
          />
        ) : null
      ) : <button type="button" onClick={() => void loadMonitoring()} disabled={loading} style={{ padding: "0.45rem 0.9rem" }}>{loading ? "Loading..." : "Refresh Monitoring"}</button>}
    </section>
  );
}
