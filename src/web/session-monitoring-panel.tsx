import React from "react";
import { MonitoringAttemptDetails } from "./monitoring-attempt-details";
import type {
  AdminMonitoringView,
  MonitoringAttemptResult,
  MonitoringAttemptView,
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

const panelShellStyle: React.CSSProperties = {
  display: "grid",
  gap: "1rem",
};

const introStyle: React.CSSProperties = {
  color: "#4b5563",
  marginTop: 0,
};

const statusStripStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
  marginBottom: "0.5rem",
};

const statusMetricStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.25rem",
  minWidth: "120px",
  flex: "1 1 120px",
  padding: "0.75rem 0.85rem",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  background: "#fff",
};

const statusMetricLabelStyle: React.CSSProperties = {
  color: "#4b5563",
  fontSize: "0.8rem",
  fontWeight: 600,
};

const statusMetricValueStyle: React.CSSProperties = {
  color: "#111827",
  fontSize: "1.45rem",
  fontWeight: 700,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  color: "#111827",
};

const sectionBodyStyle: React.CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontSize: "0.92rem",
};

const contentGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
  alignItems: "start",
};

const queueSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.85rem",
  paddingTop: "0.85rem",
  borderTop: "3px solid #d1d5db",
};

const historySectionStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.85rem",
  paddingTop: "0.85rem",
  borderTop: "3px solid #c7d2fe",
};

const queueListStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
};

export function buildMonitoringHistoryAttemptKey(attempt: Pick<MonitoringAttemptView, "id">): string {
  return attempt.id;
}

function renderAttemptCard(
  attempt: MonitoringAttemptView,
  onOpenSupportDiagnostics: (examAttemptId: string) => void,
) {
  return (
    <details
      key={buildMonitoringHistoryAttemptKey(attempt)}
      style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "6px", padding: "0.75rem 0.9rem" }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "flex-start",
        }}
      >
        <span style={{ minWidth: 0 }}>
          {attempt.candidateName} · {attempt.examTitle} · {formatMonitoringResult(attempt.result)}
        </span>
        <span
          style={{
            padding: "0.2rem 0.45rem",
            borderRadius: "999px",
            background: "#f8fafc",
            border: "1px solid #d1d5db",
            color: "#374151",
            fontSize: "0.75rem",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {formatAttemptStatus(attempt.status)}
        </span>
      </summary>
      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
        <MonitoringAttemptDetails
          attempt={attempt}
          scheduledForLabel={formatUtcTimestamp(attempt.scheduledFor)}
          onOpenSupportDiagnostics={onOpenSupportDiagnostics}
        />
        <div style={{ color: "#555" }}>
          Investigation opens Support Diagnostics filtered to this ExamAttempt ID.
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
  const summaryMetrics = [
    ["Scheduled", monitoring.summary.scheduled],
    ["Ready", monitoring.summary.ready],
    ["In Progress", monitoring.summary.inProgress],
    ["Suspended", monitoring.summary.suspended],
    ["Completed", monitoring.summary.completed],
    ["Expired", monitoring.summary.expired],
  ] as const;

  const liveQueues = [
    { label: "Scheduled queue", attempts: monitoring.currentAttempts.scheduled },
    { label: "Ready queue", attempts: monitoring.currentAttempts.ready },
    { label: "In-progress queue", attempts: monitoring.currentAttempts.inProgress },
    { label: "Suspended queue", attempts: monitoring.currentAttempts.suspended },
  ] as const;

  return (
    <section style={panelShellStyle}>
      <p style={introStyle}>
        Session Monitoring is the current-state operations surface for active ExamAttempts. Use Support
        Diagnostics for the forensic trace of what happened and in what order. Summary counts cover the
        full monitoring state, while completed and expired history stays bounded for scanning.
      </p>
      <button onClick={onRefresh} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
        {loading ? "Loading..." : "Refresh Monitoring"}
      </button>
      <div>
        <h2 style={sectionTitleStyle}>Monitoring status</h2>
        <p style={sectionBodyStyle}>Summary counts across live queues and terminal history.</p>
      </div>
      <div style={statusStripStyle}>
        {summaryMetrics.map(([label, value]) => (
          <div key={label} style={statusMetricStyle}>
            <div style={statusMetricLabelStyle}>{label}</div>
            <div style={statusMetricValueStyle}>{value}</div>
          </div>
        ))}
      </div>

      <div style={contentGridStyle}>
        <section aria-labelledby="live-queues-heading" style={queueSectionStyle}>
          <div>
            <h2 id="live-queues-heading" style={sectionTitleStyle}>
              Live queues
            </h2>
            <p style={sectionBodyStyle}>Current ExamAttempts by state, grouped for quick scanning.</p>
          </div>
          {liveQueues.map(({ label, attempts }: MonitoringQueueSection) => (
            <div key={label}>
              <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#111827" }}>{label}</h3>
              {attempts.length === 0 ? (
                <p style={{ margin: 0, color: "#6b7280" }}>No attempts in this queue.</p>
              ) : (
                <div style={queueListStyle}>
                  {attempts.map((attempt) => renderAttemptCard(attempt, onOpenSupportDiagnostics))}
                </div>
              )}
            </div>
          ))}
        </section>

        <section aria-labelledby="history-heading" style={historySectionStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <h2 id="history-heading" style={sectionTitleStyle}>
                Completed / expired history (showing {monitoring.history.length} of {monitoring.historyPage.total})
              </h2>
              {monitoring.historyPage.hasMore ? (
                <button onClick={onLoadMoreHistory} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
                  {loading ? "Loading..." : "Load more history"}
                </button>
              ) : null}
            </div>
            <p style={sectionBodyStyle}>Bounded history remains available for comparison without overwhelming the live queues.</p>
          </div>
          {monitoring.history.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No completed or expired attempts yet.</p>
          ) : (
            <div style={queueListStyle}>
              {monitoring.history.map((attempt) => renderAttemptCard(attempt, onOpenSupportDiagnostics))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
