import React from "react";
import { MonitoringAttemptDetails } from "./monitoring-attempt-details";
import type {
  AdminMonitoringView,
  MonitoringAttemptResult,
  MonitoringAttemptView,
  MonitoringTimelineEntry,
} from "@/domain/admin-monitoring";

export interface SessionMonitoringPanelProps {
  readonly monitoring: AdminMonitoringView;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onLoadMoreHistory: () => void;
  readonly onOpenSupportDiagnostics: (examAttemptId: string) => void;
}

function formatUtcTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function formatAttemptStatus(status: MonitoringAttemptView["status"]): string {
  return status.replaceAll("_", " ");
}

function formatMonitoringResult(result: MonitoringAttemptResult | undefined): string {
  if (!result) {
    return "-";
  }
  if (!result.scoreAvailable) {
    return formatAttemptStatus(result.status);
  }
  const percent = typeof result.percentComplete === "number" ? `${result.percentComplete}%` : "Score";
  const steps =
    typeof result.stepsCompleted === "number" && typeof result.stepsTotal === "number"
      ? ` (${result.stepsCompleted}/${result.stepsTotal} steps)`
      : "";
  return `${percent}${steps}`;
}

function formatTimelineEntry(entry: MonitoringTimelineEntry): string {
  if (entry.kind === "audit") {
    return entry.error ?? (entry.details ? JSON.stringify(entry.details) : "-");
  }
  const status = typeof entry.responseStatus === "number" ? `HTTP ${entry.responseStatus}` : entry.failureMode ?? "failure";
  const attemptedOperation = entry.attemptedOperation ? `${entry.attemptedOperation} ` : "";
  return `${attemptedOperation}${status}`.trim();
}

export function buildMonitoringHistoryAttemptKey(attempt: Pick<MonitoringAttemptView, "id">): string {
  return attempt.id;
}

export function buildMonitoringTimelineEntryKey(
  examAttemptId: string,
  entry: MonitoringTimelineEntry,
): string {
  return `${examAttemptId}-${entry.kind}-${entry.id}`;
}

function renderAttemptCard(
  attempt: MonitoringAttemptView,
  onOpenSupportDiagnostics: (examAttemptId: string) => void,
) {
  return (
    <details
      key={buildMonitoringHistoryAttemptKey(attempt)}
      style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.75rem 0.9rem" }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {attempt.candidateName} · {attempt.examTitle} · {formatMonitoringResult(attempt.result)}
      </summary>
      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
        <div>Status: {formatAttemptStatus(attempt.status)}</div>
        <MonitoringAttemptDetails
          attempt={attempt}
          scheduledForLabel={formatUtcTimestamp(attempt.scheduledFor)}
          onOpenSupportDiagnostics={onOpenSupportDiagnostics}
        />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                {["Time", "Kind", "Event", "Outcome", "Details"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #ddd" }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attempt.timeline.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "0.4rem", color: "#666" }}>
                    No timeline entries recorded.
                  </td>
                </tr>
              )}
              {attempt.timeline.map((entry) => (
                <tr
                  key={buildMonitoringTimelineEntryKey(attempt.id, entry)}
                  style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}
                >
                  <td style={{ padding: "0.35rem", whiteSpace: "nowrap" }}>
                    {formatUtcTimestamp(entry.occurredAt)}
                  </td>
                  <td style={{ padding: "0.35rem" }}>{entry.kind}</td>
                  <td style={{ padding: "0.35rem" }}>{entry.kind === "audit" ? entry.action : entry.eventType}</td>
                  <td style={{ padding: "0.35rem" }}>
                    {entry.kind === "audit"
                      ? entry.outcome
                      : (typeof entry.responseStatus === "number" ? `HTTP ${entry.responseStatus}` : entry.failureMode ?? "-")}
                  </td>
                  <td style={{ padding: "0.35rem", color: "#444" }}>{formatTimelineEntry(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

interface MonitoringQueueSection {
  readonly label: string;
  readonly attempts: readonly MonitoringAttemptView[];
}

export function SessionMonitoringPanel({
  monitoring,
  loading,
  onRefresh,
  onLoadMoreHistory,
  onOpenSupportDiagnostics,
}: SessionMonitoringPanelProps) {
  return (
    <section>
      <p style={{ color: "#555", marginTop: 0 }}>
        Session Monitoring is the current-state operations surface for active ExamAttempts. Use Support
        Diagnostics for the forensic trace of what happened and in what order. Summary counts cover the
        full monitoring state, while completed and expired history stays bounded for scanning.
      </p>
      <button onClick={onRefresh} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
        {loading ? "Loading..." : "Refresh Monitoring"}
      </button>
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: "1rem" }}>
        {[
          ["Scheduled", monitoring.summary.scheduled],
          ["Ready", monitoring.summary.ready],
          ["In Progress", monitoring.summary.inProgress],
          ["Suspended", monitoring.summary.suspended],
          ["Completed", monitoring.summary.completed],
          ["Expired", monitoring.summary.expired],
        ].map(([label, value]) => (
          <div key={label} style={{ background: "#f7f7f8", borderRadius: "8px", padding: "0.85rem 1rem" }}>
            <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.35rem" }}>{label}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: "1rem", marginBottom: "1rem" }}>
        {[
          { label: "Scheduled queue", attempts: monitoring.currentAttempts.scheduled },
          { label: "Ready queue", attempts: monitoring.currentAttempts.ready },
          { label: "In-progress queue", attempts: monitoring.currentAttempts.inProgress },
          { label: "Suspended queue", attempts: monitoring.currentAttempts.suspended },
        ].map(({ label, attempts }: MonitoringQueueSection) => (
          <div key={label} style={{ background: "#f7f7f8", borderRadius: "8px", padding: "1rem" }}>
            <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>{label}</h2>
            {attempts.length === 0 ? (
              <p style={{ margin: 0, color: "#666" }}>No attempts in this queue.</p>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {attempts.map((attempt) => renderAttemptCard(attempt, onOpenSupportDiagnostics))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ background: "#f7f7f8", borderRadius: "8px", padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1rem" }}>
            Completed / expired history (showing {monitoring.history.length} of {monitoring.historyPage.total})
          </h2>
          {monitoring.historyPage.hasMore ? (
            <button onClick={onLoadMoreHistory} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              {loading ? "Loading..." : "Load more history"}
            </button>
          ) : null}
        </div>
        {monitoring.history.length === 0 ? (
          <p style={{ margin: 0, color: "#666" }}>No completed or expired attempts yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {monitoring.history.map((attempt) => renderAttemptCard(attempt, onOpenSupportDiagnostics))}
          </div>
        )}
      </div>
    </section>
  );
}
