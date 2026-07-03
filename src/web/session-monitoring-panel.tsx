import React from "react";
import { formatLocalDateTimeMinute } from "./candidate-date-format";
import { MonitoringAttemptDetails } from "./monitoring-attempt-details";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { compactButtonStyle } from "./button-styles";
import { statusBadgeStyle, getExamAttemptStatusTone, type StatusTone } from "./status-badge";
import { colors } from "./design-tokens";
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

export type MonitoringStatusFilter = MonitoringAttemptView["status"];

export interface MonitoringFilters {
  readonly status: MonitoringStatusFilter | null;
  readonly candidateEmail: string;
  readonly identifier: string;
}

const EMPTY_MONITORING_FILTERS: MonitoringFilters = {
  status: null,
  candidateEmail: "",
  identifier: "",
};

function formatLocalMinuteTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return formatLocalDateTimeMinute(value) ?? value;
}

function getOpenWindowSummary(
  attempt: Pick<MonitoringAttemptView, "scheduledFor" | "examOpenPeriodMinutes">,
): { readonly startLabel: string; readonly endLabel: string; readonly durationLabel: string } {
  const startLabel = formatLocalMinuteTimestamp(attempt.scheduledFor);
  const parsedStart = attempt.scheduledFor ? new Date(attempt.scheduledFor) : null;
  const endLabel =
    parsedStart && !Number.isNaN(parsedStart.getTime()) && Number.isFinite(attempt.examOpenPeriodMinutes)
      ? formatLocalMinuteTimestamp(
          new Date(parsedStart.getTime() + attempt.examOpenPeriodMinutes * 60_000).toISOString(),
        )
      : "-";
  const durationLabel = Number.isFinite(attempt.examOpenPeriodMinutes)
    ? `${attempt.examOpenPeriodMinutes} min`
    : "-";

  return { startLabel, endLabel, durationLabel };
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
  ...cardStyle,
  border: undefined,
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: colors.border,
  display: "grid",
  gap: "0.25rem",
  minWidth: "120px",
  flex: "1 1 120px",
  padding: "0.75rem 0.85rem",
};

const selectedStatusMetricStyle: React.CSSProperties = {
  borderColor: colors.info,
  background: colors.infoSoft,
  boxShadow: "inset 0 0 0 1px #bfdbfe",
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

const filterPanelStyle: React.CSSProperties = {
  ...mutedPanelStyle,
  display: "grid",
  gap: "0.75rem",
  padding: "0.9rem",
};

const filterGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
  alignItems: "end",
};

const filterLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.35rem",
  color: "#111827",
  fontSize: "0.9rem",
  minWidth: 0,
};

const filterInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "0.45rem 0.55rem",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
};

const contentGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
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

const queueCardBaseStyle: React.CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "0.75rem",
  padding: "0.9rem",
};

// Queue tint reuses the same tone tokens as the ExamAttempt status badge
// (see @/web/status-badge) so a queue card's background and the status
// badges rendered inside it never disagree about what a status "means".
const queueToneSoftBackground: Record<StatusTone, string> = {
  neutral: colors.neutralSoft,
  info: colors.infoSoft,
  positive: colors.successSoft,
  warning: colors.warningSoft,
  negative: colors.dangerSoft,
};

function getQueueCardStyle(status: MonitoringAttemptView["status"]): React.CSSProperties {
  const tone = getExamAttemptStatusTone(status);
  return {
    ...queueCardBaseStyle,
    background: queueToneSoftBackground[tone],
  };
}

const queueHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.95rem",
  color: "#111827",
};

const queueCountPillStyle: React.CSSProperties = {
  padding: "0.15rem 0.45rem",
  borderRadius: "999px",
  border: "1px solid #d1d5db",
  background: "rgba(255, 255, 255, 0.72)",
  color: "#374151",
  fontSize: "0.75rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export function buildMonitoringHistoryAttemptKey(attempt: Pick<MonitoringAttemptView, "id">): string {
  return attempt.id;
}

function normaliseMonitoringFilterText(value: string): string {
  return value.trim().toLowerCase();
}

function matchesMonitoringFilters(
  attempt: MonitoringAttemptView,
  filters: MonitoringFilters,
): boolean {
  if (filters.status && attempt.status !== filters.status) {
    return false;
  }

  const candidateEmailFilter = normaliseMonitoringFilterText(filters.candidateEmail);
  if (candidateEmailFilter && !attempt.candidateEmail.toLowerCase().includes(candidateEmailFilter)) {
    return false;
  }

  const identifierFilter = normaliseMonitoringFilterText(filters.identifier);
  if (!identifierFilter) {
    return true;
  }

  return (
    attempt.id.toLowerCase().includes(identifierFilter) ||
    attempt.examId.toLowerCase().includes(identifierFilter)
  );
}

export function applyMonitoringFilters(
  monitoring: AdminMonitoringView,
  filters: MonitoringFilters,
): AdminMonitoringView {
  return {
    ...monitoring,
    currentAttempts: {
      scheduled: monitoring.currentAttempts.scheduled.filter((attempt) =>
        matchesMonitoringFilters(attempt, filters),
      ),
      ready: monitoring.currentAttempts.ready.filter((attempt) =>
        matchesMonitoringFilters(attempt, filters),
      ),
      inProgress: monitoring.currentAttempts.inProgress.filter((attempt) =>
        matchesMonitoringFilters(attempt, filters),
      ),
      suspended: monitoring.currentAttempts.suspended.filter((attempt) =>
        matchesMonitoringFilters(attempt, filters),
      ),
    },
    history: monitoring.history.filter((attempt) => matchesMonitoringFilters(attempt, filters)),
  };
}

function hasActiveMonitoringFilters(filters: MonitoringFilters): boolean {
  return (
    filters.status !== null ||
    filters.candidateEmail.trim().length > 0 ||
    filters.identifier.trim().length > 0
  );
}

function renderAttemptCard(
  attempt: MonitoringAttemptView,
  onOpenSupportDiagnostics: (examAttemptId: string) => void,
  options: { readonly showStatusBadge?: boolean } = {},
) {
  const showStatusBadge = options.showStatusBadge ?? true;
  const openWindow = getOpenWindowSummary(attempt);

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
        <span style={{ minWidth: 0, flex: "1 1 auto", overflowWrap: "anywhere", display: "grid", gap: "0.1rem" }}>
          <span style={{ color: "#111827", fontWeight: 500 }}>
            {attempt.candidateName}{" "}
            <strong style={{ color: "#111827", fontWeight: 700 }}>{attempt.candidateEmail}</strong>
          </span>
          <span style={{ color: "#4b5563", fontWeight: 400 }}>
            {attempt.examTitle}
            {attempt.result ? ` · ${formatMonitoringResult(attempt.result)}` : ""}
          </span>
          <span
            style={{
              color: "#4b5563",
              fontSize: "0.82rem",
              fontWeight: 400,
              display: "grid",
              gap: "0.1rem",
            }}
          >
            <span style={{ color: "#374151", fontWeight: 600 }}>Open window</span>
            <span>Starts {openWindow.startLabel}</span>
            <span>Closes {openWindow.endLabel}</span>
            <span>Duration {openWindow.durationLabel}</span>
          </span>
        </span>
        {showStatusBadge ? (
          <span style={statusBadgeStyle(getExamAttemptStatusTone(attempt.status))}>
            {formatAttemptStatus(attempt.status)}
          </span>
        ) : null}
      </summary>
      <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
        <MonitoringAttemptDetails
          attempt={attempt}
          onOpenSupportDiagnostics={onOpenSupportDiagnostics}
        />
        <div style={{ color: "#555" }}>
          Investigation opens Support Diagnostics filtered to this ExamAttempt ID.
        </div>
      </div>
    </details>
  );
}

export function SessionMonitoringPanel({
  monitoring,
  loading,
  onRefresh,
  onLoadMoreHistory,
  onOpenSupportDiagnostics,
}: SessionMonitoringPanelProps) {
  const [filters, setFilters] = React.useState<MonitoringFilters>(EMPTY_MONITORING_FILTERS);
  const summaryMetrics = [
    { label: "Scheduled", status: "scheduled", value: monitoring.summary.scheduled },
    { label: "Ready", status: "ready", value: monitoring.summary.ready },
    { label: "In Progress", status: "in_progress", value: monitoring.summary.inProgress },
    { label: "Suspended", status: "suspended", value: monitoring.summary.suspended },
    { label: "Completed", status: "completed", value: monitoring.summary.completed },
    { label: "Expired", status: "expired", value: monitoring.summary.expired },
  ] as const;

  const filteredMonitoring = applyMonitoringFilters(monitoring, filters);
  const activeFilterCount =
    (filters.status ? 1 : 0) +
    (filters.candidateEmail.trim() ? 1 : 0) +
    (filters.identifier.trim() ? 1 : 0);
  const hasFilters = hasActiveMonitoringFilters(filters);

  const liveQueues = [
    {
      label: "Scheduled queue",
      status: "scheduled",
      attempts: filteredMonitoring.currentAttempts.scheduled,
      style: getQueueCardStyle("scheduled"),
      badgeCount: filteredMonitoring.currentAttempts.scheduled.length,
    },
    {
      label: "Ready queue",
      status: "ready",
      attempts: filteredMonitoring.currentAttempts.ready,
      style: getQueueCardStyle("ready"),
      badgeCount: filteredMonitoring.currentAttempts.ready.length,
    },
    {
      label: "In-progress queue",
      status: "in_progress",
      attempts: filteredMonitoring.currentAttempts.inProgress,
      style: getQueueCardStyle("in_progress"),
      badgeCount: filteredMonitoring.currentAttempts.inProgress.length,
    },
    {
      label: "Suspended queue",
      status: "suspended",
      attempts: filteredMonitoring.currentAttempts.suspended,
      style: getQueueCardStyle("suspended"),
      badgeCount: filteredMonitoring.currentAttempts.suspended.length,
    },
  ] as const;

  const visibleLiveQueues = liveQueues.filter(({ status }) => !filters.status || filters.status === status);
  const showHistorySection = !filters.status || filters.status === "completed" || filters.status === "expired";
  const hasVisibleLiveAttempts = visibleLiveQueues.some(({ attempts }) => attempts.length > 0);
  const hasVisibleHistoryAttempts = showHistorySection && filteredMonitoring.history.length > 0;
  const hasAnyVisibleAttempts = hasVisibleLiveAttempts || hasVisibleHistoryAttempts;

  return (
    <section style={panelShellStyle}>
      <p style={introStyle}>
        Session Monitoring is the current-state operations surface for active ExamAttempts. Use Support
        Diagnostics for the forensic trace of what happened and in what order. Summary counts cover the
        full monitoring state, while completed and expired history stays bounded for scanning.
      </p>
      <button onClick={onRefresh} disabled={loading} style={{ ...compactButtonStyle, marginBottom: "1rem" }}>
        {loading ? "Loading..." : "Refresh Monitoring"}
      </button>
      <div>
        <h2 style={sectionTitleStyle}>Monitoring status</h2>
        <p style={sectionBodyStyle}>Summary counts across live queues and terminal history.</p>
      </div>
      <div style={statusStripStyle}>
        {summaryMetrics.map(({ label, status, value }) => (
          <button
            key={label}
            type="button"
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: current.status === status ? null : status,
              }))
            }
            aria-pressed={filters.status === status}
            style={{
              ...statusMetricStyle,
              ...(filters.status === status ? selectedStatusMetricStyle : null),
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <div style={statusMetricLabelStyle}>{label}</div>
            <div style={statusMetricValueStyle}>{value}</div>
          </button>
        ))}
      </div>
      <section aria-label="Monitoring filters" style={filterPanelStyle}>
        <div>
          <h2 style={sectionTitleStyle}>Investigation filters</h2>
          <p style={sectionBodyStyle}>
            Narrow the current monitoring view by status, candidate email, or Exam ID / ExamAttempt ID.
          </p>
        </div>
        <div style={filterGridStyle}>
          <label style={filterLabelStyle}>
            <span>Candidate email</span>
            <input
              type="text"
              value={filters.candidateEmail}
              onChange={(event) =>
                setFilters((current) => ({ ...current, candidateEmail: event.target.value }))
              }
              placeholder="candidate@helioscx.demo"
              style={filterInputStyle}
            />
          </label>
          <label style={filterLabelStyle}>
            <span>Exam ID or ExamAttempt ID</span>
            <input
              type="text"
              value={filters.identifier}
              onChange={(event) => setFilters((current) => ({ ...current, identifier: event.target.value }))}
              placeholder="exam-123 or attempt-123"
              style={filterInputStyle}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setFilters(EMPTY_MONITORING_FILTERS)}
            disabled={!hasFilters}
            style={compactButtonStyle}
          >
            Clear filters
          </button>
          {hasFilters ? (
            <span style={{ color: "#4b5563", fontSize: "0.9rem" }}>
              {activeFilterCount} monitoring filter{activeFilterCount === 1 ? "" : "s"} active.
            </span>
          ) : (
            <span style={{ color: "#4b5563", fontSize: "0.9rem" }}>
              No monitoring filters applied.
            </span>
          )}
        </div>
      </section>

      <div style={contentGridStyle}>
        <section aria-labelledby="live-queues-heading" style={queueSectionStyle}>
          <div>
            <h2 id="live-queues-heading" style={sectionTitleStyle}>
              Live queues
            </h2>
            <p style={sectionBodyStyle}>Current ExamAttempts by state, grouped for quick scanning.</p>
          </div>
          {visibleLiveQueues.map(({ label, attempts, style, badgeCount }) => (
            <div key={label} style={style}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                <h3 style={queueHeadingStyle}>{label}</h3>
                <span style={queueCountPillStyle}>{badgeCount}</span>
              </div>
              {attempts.length === 0 ? (
                <p style={{ margin: 0, color: "#6b7280" }}>No attempts in this queue.</p>
              ) : (
                <div style={queueListStyle}>
                  {attempts.map((attempt) => renderAttemptCard(attempt, onOpenSupportDiagnostics, { showStatusBadge: false }))}
                </div>
              )}
            </div>
          ))}
        </section>

        {showHistorySection ? (
          <section aria-labelledby="history-heading" style={historySectionStyle}>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <h2 id="history-heading" style={sectionTitleStyle}>
                  Completed / expired history (showing {filteredMonitoring.history.length} of {monitoring.historyPage.total})
                </h2>
                {monitoring.historyPage.hasMore ? (
                  <button onClick={onLoadMoreHistory} disabled={loading} style={compactButtonStyle}>
                    {loading ? "Loading..." : "Load more history"}
                  </button>
                ) : null}
              </div>
              <p style={sectionBodyStyle}>Bounded history remains available for comparison without overwhelming the live queues.</p>
            </div>
            {filteredMonitoring.history.length === 0 ? (
              <p style={{ margin: 0, color: "#6b7280" }}>
                {hasFilters
                  ? hasVisibleLiveAttempts
                    ? "No completed or expired attempts match the current monitoring filters."
                    : "No attempts match the current monitoring filters."
                  : "No completed or expired attempts yet."}
              </p>
            ) : (
              <div style={queueListStyle}>
                {filteredMonitoring.history.map((attempt) =>
                  renderAttemptCard(attempt, onOpenSupportDiagnostics, { showStatusBadge: true }),
                )}
              </div>
            )}
          </section>
        ) : null}
      </div>
      {hasFilters && !hasAnyVisibleAttempts && !showHistorySection ? (
        <p style={{ margin: 0, color: "#6b7280" }}>No attempts match the current monitoring filters.</p>
      ) : null}
    </section>
  );
}
