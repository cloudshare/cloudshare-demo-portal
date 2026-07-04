"use client";

import React, { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  loadCandidateDashboard,
  scheduleCandidateExam,
  shouldShowNoPublishedExams,
  shouldShowPublishedExamList,
  type CandidateDashboardData,
} from "./candidate-scheduling";
import {
  buildCandidateExamDurationLabels,
  buildCandidateAttemptQueueState,
  COLD_START_WARNING_MESSAGE,
  type CandidateAttemptStatusFilter,
  type CandidateAttemptStatusFilterView,
  getAttemptWaitingMessage,
  getCurrentAttemptForExam,
  getNextEnterabilityWakeUpDelayMs,
  getNextScheduleAvailableLabelForExam,
  getAttemptPrimaryAction,
  getCandidateCurrentAttemptLabel,
} from "./candidate-home-state";
import { formatCandidateAttemptStatus } from "./candidate-lab-state";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import {
  publishedExamDescriptionStyle,
  publishedExamDurationPillsStyle,
  publishedExamHeaderStyle,
  publishedExamTitleBlockStyle,
  publishedExamTitleRowStyle,
} from "./candidate-home-layout";
import { useCandidateLogout } from "./candidate-logout";
import { pageShellStyle } from "./page-shell";
import {
  isPortalSessionExpiredError,
  startPortalSessionWatchdog,
} from "./session-expiry";
import { cardStyle, mutedPanelStyle, alertPanelStyle } from "./card-styles";
import {
  accountLogoutButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  disabledButtonStyle,
} from "./button-styles";
import { statusBadgeStyle, getExamAttemptStatusTone } from "./status-badge";
import { eyebrowLabelStyle } from "./design-tokens";
import { PortalPageHeader } from "./portal-page-header";

interface CandidateHomeProps {
  readonly email: string;
}

type ScheduleFeedback = {
  readonly kind: "error" | "warning";
  readonly message: string;
};

export function PublishedExamCardHeader({
  title,
  description,
  runtimeLimit,
  openWindow,
}: {
  readonly title: string;
  readonly description: string;
  readonly runtimeLimit: string;
  readonly openWindow: string;
}) {
  return (
    <div style={publishedExamHeaderStyle}>
      <div style={publishedExamTitleRowStyle}>
        <div style={publishedExamTitleBlockStyle}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>{title}</h3>
        </div>
        <div style={publishedExamDurationPillsStyle}>
          <span style={statusBadgeStyle("info")}>{runtimeLimit}</span>
          <span style={statusBadgeStyle("info")}>{openWindow}</span>
        </div>
      </div>
      <p style={publishedExamDescriptionStyle}>
        {description || "No description provided."}
      </p>
    </div>
  );
}

export function CandidateAttemptStatusFilterButtons({
  filters,
  activeFilter,
  onFilterChange,
}: {
  readonly filters: CandidateAttemptStatusFilterView[];
  readonly activeFilter: CandidateAttemptStatusFilter;
  readonly onFilterChange: (filter: CandidateAttemptStatusFilter) => void;
}) {
  return (
    <div aria-label="Exam attempt status filters" style={attemptFilterStripStyle}>
      {filters.map((filter) => {
        const selected = filter.filter === activeFilter;
        return (
          <button
            key={filter.filter}
            type="button"
            aria-pressed={selected}
            onClick={() => onFilterChange(filter.filter)}
            style={{
              ...attemptFilterButtonStyle,
              ...(selected ? selectedAttemptFilterButtonStyle : null),
            }}
          >
            <span style={attemptFilterLabelStyle}>{filter.label}</span>
            <span style={attemptFilterCountStyle}>{filter.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CandidatePublishedExamScheduleShell({
  examCount,
  children,
}: {
  readonly examCount: number;
  readonly children?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      style={cardStyle}
    >
      <summary style={scheduleSummaryStyle}>
        <div>
          <p style={eyebrowLabelStyle}>Published Exams</p>
          <h2 style={sectionTitleStyle}>Browse and schedule</h2>
          <p style={{ ...sectionCopyStyle, marginTop: "0.35rem" }}>
            {examCount} published {examCount === 1 ? "Exam" : "Exams"}
          </p>
        </div>
        <span style={scheduleSummaryActionStyle}>
          {isOpen ? "Hide scheduling options" : "Browse scheduling options"}
        </span>
      </summary>
      {isOpen ? <div style={scheduleDisclosureBodyStyle}>{children}</div> : null}
    </details>
  );
}

export function CandidateHome({ email }: CandidateHomeProps) {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<CandidateDashboardData>({
    exams: [],
    attempts: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingExamId, setSubmittingExamId] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [scheduleFeedback, setScheduleFeedback] = useState<Record<string, ScheduleFeedback>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionExpired, setSessionExpired] = useState(false);
  const [selectedAttemptFilter, setSelectedAttemptFilter] = useState<CandidateAttemptStatusFilter>("live");
  const { presentation: logoutPresentation, logout } = useCandidateLogout(router);

  const handleCandidateSessionExpired = useCallback(() => {
    setSessionExpired(true);
    setError(null);
    setScheduleFeedback({});
    router.replace("/login");
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (sessionExpired) {
      return;
    }

    const watchdog = startPortalSessionWatchdog({
      fetchImpl: fetch,
      onExpired: handleCandidateSessionExpired,
    });
    void watchdog.checkNow();

    return () => watchdog.stop();
  }, [handleCandidateSessionExpired, sessionExpired]);

  useEffect(() => {
    if (sessionExpired) {
      return;
    }

    let cancelled = false;
    let refreshInFlight = false;

    async function loadDashboard(showLoading = false) {
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      if (showLoading) {
        setLoading(true);
      }
      try {
        if (!cancelled) {
          setError(null);
          setDashboard(await loadCandidateDashboard(fetch));
          setNowMs(Date.now());
        }
      } catch (caughtError) {
        if (!cancelled) {
          if (isPortalSessionExpiredError(caughtError)) {
            handleCandidateSessionExpired();
            return;
          }
          setError("Failed to load candidate dashboard");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        refreshInFlight = false;
      }
    }

    function refreshIfVisible() {
      if (document.visibilityState === "visible") {
        void loadDashboard();
      }
    }

    void loadDashboard(true);
    const interval = window.setInterval(() => {
      void loadDashboard();
    }, 30_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [handleCandidateSessionExpired, sessionExpired]);

  useEffect(() => {
    const delayMs = getNextEnterabilityWakeUpDelayMs(dashboard.attempts, nowMs, dashboard.exams);
    if (delayMs === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [dashboard.attempts, dashboard.exams, nowMs]);

  async function submitSchedule(examId: string) {
    const scheduledFor = scheduleDrafts[examId];
    if (!scheduledFor) {
      setScheduleFeedback((current) => ({
        ...current,
        [examId]: { kind: "error", message: "Choose a future date and time before scheduling." },
      }));
      return;
    }

    setSubmittingExamId(examId);
    setError(null);
    setScheduleFeedback((current) => {
      const next = { ...current };
      delete next[examId];
      return next;
    });
    try {
      const result = await scheduleCandidateExam(fetch, {
        examId,
        scheduledFor: new Date(scheduledFor).toISOString(),
      });
      setDashboard((current) => ({
        ...current,
        attempts: [
          current.attempts.filter((attempt) => attempt.id !== result.attempt.id),
          result.attempt,
        ].flat(),
      }));
      setNowMs(Date.now());
      if (result.coldStartLikely) {
        setScheduleFeedback((current) => ({
          ...current,
          [examId]: { kind: "warning", message: COLD_START_WARNING_MESSAGE },
        }));
      }
    } catch (cause) {
      if (isPortalSessionExpiredError(cause)) {
        handleCandidateSessionExpired();
        return;
      }
      setScheduleFeedback((current) => ({
        ...current,
        [examId]: {
          kind: "error",
          message: cause instanceof Error ? cause.message : "Failed to schedule exam",
        },
      }));
    } finally {
      setSubmittingExamId(null);
    }
  }

  function attemptForExam(examId: string) {
    return getCurrentAttemptForExam(dashboard.attempts, examId);
  }

  function openLabConsole(attemptId: string, attemptStatus: string) {
    const params = new URLSearchParams({
      examAttemptId: attemptId,
      attemptStatus,
    });
    router.push(`/candidate/lab?${params.toString()}`);
  }

  function openScorePage(attemptId: string) {
    const params = new URLSearchParams({
      examAttemptId: attemptId,
    });
    router.push(`/candidate/score?${params.toString()}`);
  }

  const attemptQueue = buildCandidateAttemptQueueState(dashboard, nowMs, selectedAttemptFilter);
  const examsById = new Map(dashboard.exams.map((exam) => [exam.id, exam]));

  return (
    <main style={pageShellStyle}>
      <PortalPageHeader
        eyebrow="Certalis Candidate Portal"
        title="Candidate Home"
        description="Review your scheduled Exams, enter or resume active sessions, and schedule the next published Helios CX Exam from one place."
        email={email}
        actions={
          <button
            onClick={() => void logout()}
            disabled={logoutPresentation.disabled}
            style={getButtonStyle(accountLogoutButtonStyle, logoutPresentation.disabled)}
          >
            {logoutPresentation.buttonLabel}
          </button>
        }
      />
      {logoutPresentation.statusMessage ? (
        <p role="status" style={{ marginTop: 0, marginBottom: "1rem", color: "#555" }}>
          {logoutPresentation.statusMessage}
        </p>
      ) : null}
      {logoutPresentation.errorMessage ? (
        <p role="alert" style={{ marginTop: 0, marginBottom: "1rem", color: "#b00020" }}>
          {logoutPresentation.errorMessage}
        </p>
      ) : null}

      <section style={{ display: "grid", gap: "1rem" }}>
        {loading && <p style={mutedPanelStyle}>Loading candidate dashboard...</p>}
        {error && (
          <p style={{ ...alertPanelStyle.danger, margin: 0 }}>
            {error}
          </p>
        )}
        {dashboard.attempts.length > 0 && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowLabelStyle}>Attempt queues</p>
                <h2 style={sectionTitleStyle}>Exam attempts</h2>
              </div>
              <p style={sectionCopyStyle}>
                Live includes scheduled, ready, in-progress, and suspended attempts. Use Completed
                or Expired to inspect history.
              </p>
            </div>
            <CandidateAttemptStatusFilterButtons
              filters={attemptQueue.filters}
              activeFilter={attemptQueue.activeFilter}
              onFilterChange={setSelectedAttemptFilter}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))",
                gap: "0.75rem",
              }}
            >
              {attemptQueue.attempts.length === 0 ? (
                <p style={{ ...mutedPanelStyle, margin: 0 }}>{getCandidateAttemptQueueEmptyMessage(selectedAttemptFilter)}</p>
              ) : null}
              {attemptQueue.attempts.map((attempt) => {
                const exam = examsById.get(attempt.examId) ?? (
                  attempt.openPeriodMinutes && attempt.timeLimitMinutes
                    ? {
                        id: attempt.examId,
                        title: attempt.examTitle,
                        description: "",
                        timeLimitMinutes: attempt.timeLimitMinutes,
                        openPeriodMinutes: attempt.openPeriodMinutes,
                        storageLeaseMinutes: attempt.storageLeaseMinutes,
                        scoreRetrievalEnabled: attempt.scoreRetrievalEnabled,
                      }
                    : null
                );
                const primaryAction = getAttemptPrimaryAction(
                  {
                    id: attempt.attemptId,
                    examId: attempt.examId,
                    scheduledFor: attempt.scheduledFor,
                    status: attempt.status,
                  },
                  nowMs,
                  exam,
                );

                return (
                  <article key={attempt.attemptId} style={cardStyle}>
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "1rem",
                          flexWrap: "wrap",
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <strong style={{ display: "block", fontSize: "1rem", color: "#0f172a" }}>
                            {attempt.examTitle}
                          </strong>
                          <p style={{ margin: "0.35rem 0 0", color: "#475569", overflowWrap: "anywhere" }}>
                            Attempt ID: {attempt.attemptId}
                          </p>
                        </div>
                        <span style={statusBadgeStyle(getExamAttemptStatusTone(attempt.displayStatus))}>
                          {formatCandidateAttemptStatus(attempt.displayStatus)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                          gap: "0.75rem",
                        }}
                      >
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>Access window</span>
                          <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                            {attempt.scheduledFor && attempt.scheduledEnd ? (
                              <>
                                <span>
                                  Starts {formatCandidateScheduledDateTime(attempt.scheduledFor) ?? "TBD"}
                                </span>
                                <span>
                                  Closes {formatCandidateScheduledDateTime(attempt.scheduledEnd) ?? "TBD"}
                                  {exam ? ` (${exam.openPeriodMinutes} min)` : ""}
                                </span>
                              </>
                            ) : (
                              "TBD"
                            )}
                          </span>
                        </div>
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>Next schedule available</span>
                          <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                            {attempt.nextScheduleAvailableLabel ? (
                              <>
                                <span>{attempt.nextScheduleAvailableLabel}</span>
                                {exam ? <span style={metaHintStyle}>{getScheduleAvailabilityNote(exam)}</span> : null}
                              </>
                            ) : (
                              getAttemptScheduleAvailabilityFallback(attempt.status)
                            )}
                          </span>
                        </div>
                      </div>
                      {primaryAction.label && (
                        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            onClick={() => {
                              if (primaryAction.label === "View score") {
                                openScorePage(attempt.attemptId);
                                return;
                              }
                              openLabConsole(attempt.attemptId, attempt.status);
                            }}
                            disabled={primaryAction.disabled}
                            style={getButtonStyle(primaryButtonStyle, primaryAction.disabled)}
                          >
                            {primaryAction.label}
                          </button>
                          {attempt.waitingMessage && attempt.status === "ready" && (
                            <span style={{ color: "#555", lineHeight: 1.4 }}>{attempt.waitingMessage}</span>
                          )}
                        </div>
                      )}
                      {attempt.coldStartWarning ? (
                        <p role="status" style={{ ...alertPanelStyle.warning, margin: 0 }}>
                          {attempt.coldStartWarning}
                        </p>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
        {!error && shouldShowNoPublishedExams({ loading, examCount: dashboard.exams.length }) && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowLabelStyle}>Published Exams</p>
                <h2 style={sectionTitleStyle}>Schedule your next session</h2>
              </div>
            </div>
            <p style={{ margin: 0, color: "#475569" }}>No published Exams are available yet.</p>
          </section>
        )}

        {shouldShowPublishedExamList({ loading, examCount: dashboard.exams.length }) && (
          <CandidatePublishedExamScheduleShell examCount={dashboard.exams.length}>
            <div style={{ display: "grid", gap: "0.9rem" }}>
              {dashboard.exams.map((exam) => {
                const attempt = attemptForExam(exam.id);
                const nextScheduleAvailableLabel = getNextScheduleAvailableLabelForExam(
                  dashboard.attempts,
                  exam.id,
                  exam,
                );
                const primaryAction = getAttemptPrimaryAction(attempt, nowMs, exam);
                const durationLabels = buildCandidateExamDurationLabels(exam);
                const feedback = scheduleFeedback[exam.id] ?? null;
                return (
                  <article key={exam.id} style={cardStyle}>
                    <div style={{ display: "grid", gap: "1rem" }}>
                      <PublishedExamCardHeader
                        title={exam.title}
                        description={exam.description}
                        runtimeLimit={durationLabels.runtimeLimit}
                        openWindow={durationLabels.openWindow}
                      />
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                          gap: "0.75rem",
                        }}
                      >
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>Open period</span>
                          <span style={metaValueStyle}>
                            {durationLabels.openPeriodDetail}
                          </span>
                        </div>
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>Guided Journey scoring</span>
                          <span style={metaValueStyle}>
                            {exam.scoreRetrievalEnabled ? "Enabled" : "Not enabled for this Exam"}
                          </span>
                        </div>
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>Current attempt</span>
                          <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                            {getCandidateCurrentAttemptLabel(attempt, nowMs, exam)}
                            {nextScheduleAvailableLabel ? (
                              <span style={metaHintStyle}>
                                Next schedule available {nextScheduleAvailableLabel}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: "0.9rem",
                          alignItems: "end",
                        }}
                      >
                        <label style={{ display: "grid", gap: "0.35rem" }}>
                          <span style={{ color: "#475569", fontSize: "0.9rem", fontWeight: 600 }}>
                            Schedule date and time
                          </span>
                          <input
                            type="datetime-local"
                            value={scheduleDrafts[exam.id] ?? ""}
                            onChange={(event) => {
                              setScheduleDrafts((current) => ({
                                ...current,
                                [exam.id]: event.target.value,
                              }));
                              setScheduleFeedback((current) => {
                                const next = { ...current };
                                delete next[exam.id];
                                return next;
                              });
                            }}
                            style={inputStyle}
                          />
                        </label>
                        <div
                          style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}
                        >
                          <button
                            onClick={() => void submitSchedule(exam.id)}
                            disabled={submittingExamId === exam.id}
                            style={getButtonStyle(primaryButtonStyle, submittingExamId === exam.id)}
                          >
                            {submittingExamId === exam.id ? "Scheduling..." : "Schedule exam"}
                          </button>
                          {primaryAction.label && (
                            <button
                              onClick={() => {
                                if (!attempt) {
                                  return;
                                }
                                if (primaryAction.label === "View score") {
                                  openScorePage(attempt.id);
                                  return;
                                }
                                openLabConsole(attempt.id, attempt.status);
                              }}
                              disabled={primaryAction.disabled}
                              style={getButtonStyle(secondaryButtonStyle, primaryAction.disabled)}
                            >
                              {primaryAction.label}
                            </button>
                          )}
                        </div>
                      </div>
                      {feedback && (
                        <p
                          role={feedback.kind === "error" ? "alert" : "status"}
                          style={{
                            ...(feedback.kind === "error" ? alertPanelStyle.danger : alertPanelStyle.warning),
                            margin: 0,
                          }}
                        >
                          {feedback.message}
                        </p>
                      )}
                      {attempt?.status === "ready" && getAttemptWaitingMessage(attempt, nowMs, exam) && (
                        <p style={{ margin: 0, color: "#555", lineHeight: 1.4 }}>
                          {getAttemptWaitingMessage(attempt, nowMs, exam)}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </CandidatePublishedExamScheduleShell>
        )}
      </section>
    </main>
  );
}

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  alignItems: "flex-end",
  marginBottom: "1rem",
};

const sectionTitleStyle: CSSProperties = {
  margin: "0.2rem 0 0",
  fontSize: "1.2rem",
  color: "#0f172a",
};

const sectionCopyStyle: CSSProperties = {
  margin: 0,
  color: "#475569",
  maxWidth: "40rem",
  lineHeight: 1.5,
};

const attemptFilterStripStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
  marginBottom: "1rem",
};

const attemptFilterButtonStyle: CSSProperties = {
  ...cardStyle,
  border: "1px solid #cbd5e1",
  display: "grid",
  gap: "0.2rem",
  minWidth: "118px",
  flex: "1 1 118px",
  padding: "0.7rem 0.8rem",
  textAlign: "left",
  cursor: "pointer",
  background: "#ffffff",
};

const selectedAttemptFilterButtonStyle: CSSProperties = {
  border: "1px solid #2563eb",
  background: "#eff6ff",
  boxShadow: "inset 0 0 0 1px #bfdbfe",
};

const attemptFilterLabelStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.8rem",
  fontWeight: 600,
};

const attemptFilterCountStyle: CSSProperties = {
  color: "#0f172a",
  fontSize: "1.35rem",
  fontWeight: 700,
  lineHeight: 1.1,
};

const scheduleSummaryStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  alignItems: "center",
  cursor: "pointer",
  listStyle: "none",
};

const scheduleSummaryActionStyle: CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const scheduleDisclosureBodyStyle: CSSProperties = {
  display: "grid",
  gap: "0.9rem",
  marginTop: "1rem",
  paddingTop: "1rem",
  borderTop: "1px solid #e2e8f0",
};

const metaItemStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "0.3rem",
  padding: "0.85rem 0.9rem",
};

const metaLabelStyle: CSSProperties = {
  color: "#64748b",
  fontSize: "0.82rem",
  fontWeight: 600,
};

const metaValueStyle: CSSProperties = {
  color: "#0f172a",
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const metaHintStyle: CSSProperties = {
  color: "#64748b",
  fontSize: "0.86rem",
  lineHeight: 1.35,
};

function getScheduleAvailabilityNote(exam: CandidateDashboardData["exams"][number]): string {
  return exam.storageLeaseMinutes && exam.storageLeaseMinutes > exam.openPeriodMinutes
    ? "After environment retention"
    : "After access window";
}

function getAttemptScheduleAvailabilityFallback(
  status: CandidateDashboardData["attempts"][number]["status"],
): string {
  return status === "completed" || status === "expired" ? "No scheduling hold" : "TBD";
}

function getCandidateAttemptQueueEmptyMessage(filter: CandidateAttemptStatusFilter): string {
  if (filter === "live") {
    return "No live attempts. Use Completed or Expired to inspect attempt history.";
  }
  return `No ${filter.replaceAll("_", " ")} attempts.`;
}

function getButtonStyle(baseStyle: CSSProperties, disabled: boolean): CSSProperties {
  return disabled
    ? {
        ...baseStyle,
        ...disabledButtonStyle,
      }
    : baseStyle;
}

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "0.7rem 0.75rem",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  boxSizing: "border-box",
};

