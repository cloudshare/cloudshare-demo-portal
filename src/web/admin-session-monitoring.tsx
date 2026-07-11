"use client";

import React, { useEffect, useRef, useState } from "react";
import type { AdminMonitoringView } from "@/domain/admin-monitoring";
import type { CohortExamSessionMonitoringView } from "@/api/admin-cohort-exam-session-detail";
import type { AdminAuthenticatedRequest } from "./admin-authenticated-request";
import { isAdminSessionExpiredError } from "./admin-authenticated-request";
import { buildMonitoringHistoryQueryString, mergeMonitoringHistoryPage } from "./admin-session-monitoring-state";
import {
  createExamAttemptDiagnosticsNavigationIntent,
  type AdminNavigationIntent,
} from "./admin-shell-route";
import { SessionMonitoringPanel } from "./session-monitoring-panel";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";

type MonitoringBranch = "cohort" | "individual" | null;

export interface AdminSessionMonitoringFeatureProps {
  readonly active: boolean;
  readonly fetchAdmin: AdminAuthenticatedRequest;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
  readonly focusedExamId?: string | null;
  readonly focusedCohortSessionId?: string | null;
  readonly hasFocusedCohortSession?: boolean;
  readonly onEnsureCohortSessions?: (examId: string) => void;
  readonly cohortContent?: React.ReactNode;
  readonly renderFocusedCohort?: (input: {
    readonly detail: CohortExamSessionMonitoringView | null;
    readonly lastCheckedAt: string | null;
    readonly onRefresh: () => void;
  }) => React.ReactNode;
}

export function AdminSessionMonitoringFeature({
  active,
  fetchAdmin,
  onNavigate,
  focusedExamId,
  focusedCohortSessionId,
  hasFocusedCohortSession = false,
  onEnsureCohortSessions,
  cohortContent,
  renderFocusedCohort,
}: AdminSessionMonitoringFeatureProps) {
  const focusedCohortKey = focusedExamId && focusedCohortSessionId
    ? `${focusedExamId}/${focusedCohortSessionId}`
    : null;
  const [branch, setBranch] = useState<MonitoringBranch>(null);
  const [monitoring, setMonitoring] = useState<AdminMonitoringView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cohortDetail, setCohortDetail] = useState<CohortExamSessionMonitoringView | null>(null);
  const [cohortDetailKey, setCohortDetailKey] = useState<string | null>(null);
  const [cohortLastCheckedAt, setCohortLastCheckedAt] = useState<string | null>(null);
  const focusedCohortKeyRef = useRef(focusedCohortKey);
  focusedCohortKeyRef.current = focusedCohortKey;

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

  async function loadFocusedCohortSession(examId: string, sessionId: string) {
    const requestKey = `${examId}/${sessionId}`;
    setError(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}`,
      );
      const data = await response.json() as { monitoring?: CohortExamSessionMonitoringView; error?: string };
      if (!response.ok || !data.monitoring) {
        if (requestKey === focusedCohortKeyRef.current) {
          setError(data.error ?? "Failed to load Cohort Exam Session detail");
        }
        return;
      }
      if (requestKey !== focusedCohortKeyRef.current) return;
      setCohortDetail(data.monitoring);
      setCohortDetailKey(requestKey);
      setCohortLastCheckedAt(new Date().toISOString());
    } catch (caughtError) {
      if (requestKey === focusedCohortKeyRef.current && !isAdminSessionExpiredError(caughtError)) {
        setError("Failed to load Cohort Exam Session detail");
      }
    }
  }

  useEffect(() => {
    if (active) void loadMonitoring();
    // fetchAdmin is intentionally a stable shell adapter; reload only on route activation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !focusedExamId || !focusedCohortSessionId) return;
    if (!hasFocusedCohortSession) onEnsureCohortSessions?.(focusedExamId);
    void loadFocusedCohortSession(focusedExamId, focusedCohortSessionId);
    // Callback identity belongs to the shell composition layer; route changes drive this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    focusedExamId,
    focusedCohortSessionId,
  ]);

  useEffect(() => {
    if (!active || !focusedExamId || !focusedCohortSessionId) return;
    const interval = window.setInterval(
      () => void loadFocusedCohortSession(focusedExamId, focusedCohortSessionId),
      30_000,
    );
    return () => window.clearInterval(interval);
    // Callback identity belongs to the shell composition layer; route changes drive this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusedExamId, focusedCohortSessionId]);

  if (!active) return null;

  const focusedCohort = hasFocusedCohortSession && renderFocusedCohort
    ? renderFocusedCohort({
      detail: cohortDetailKey === focusedCohortKey ? cohortDetail : null,
      lastCheckedAt: cohortDetailKey === focusedCohortKey ? cohortLastCheckedAt : null,
      onRefresh: () => void loadFocusedCohortSession(focusedExamId!, focusedCohortSessionId!),
    })
    : null;
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
      {!focusedCohort ? (
        <div style={{ ...cardStyle, display: "flex", gap: "0.75rem", flexWrap: "wrap" }} aria-label="Session Monitoring branches">
          <button type="button" onClick={() => setBranch("cohort")} style={branch === "cohort" ? primaryButtonStyle : secondaryButtonStyle}>Cohort Exam Sessions</button>
          <button type="button" onClick={() => setBranch("individual")} style={branch === "individual" ? primaryButtonStyle : secondaryButtonStyle}>Individual Exam Delivery</button>
        </div>
      ) : null}
      {!focusedCohort && branch === null ? (
        <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
          Choose a monitoring view. Cohort Exam Sessions monitor a shared CloudShare Experience; Individual Exam Delivery monitors one Candidate attempt at a time.
        </div>
      ) : null}
      {focusedCohort}
      {!focusedCohort && branch === "cohort" ? cohortContent : null}
      {branch === "individual" ? (
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
        ) : (
          <button type="button" onClick={() => void loadMonitoring()} disabled={loading} style={{ padding: "0.45rem 0.9rem" }}>
            {loading ? "Loading..." : "Refresh Monitoring"}
          </button>
        )
      ) : null}
    </section>
  );
}
