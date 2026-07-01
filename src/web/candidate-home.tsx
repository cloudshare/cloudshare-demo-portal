"use client";

import { type CSSProperties, useEffect, useState } from "react";
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
  buildScheduledAttemptViews,
  getAttemptWaitingMessage,
  getLatestAttemptForExam,
  getNextEnterabilityWakeUpDelayMs,
  getAttemptPrimaryAction,
  getCandidateCurrentAttemptLabel,
} from "./candidate-home-state";
import { formatCandidateAttemptStatus } from "./candidate-lab-state";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import {
  candidateHomeAccountActionsStyle,
  candidateHomeAccountPanelStyle,
  candidateHomeHeaderIntroStyle,
  candidateHomeHeaderStyle,
} from "./candidate-home-layout";
import { useCandidateLogout } from "./candidate-logout";

interface CandidateHomeProps {
  readonly email: string;
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
  const [coldStartNotice, setColdStartNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { presentation: logoutPresentation, logout } = useCandidateLogout(router);

  useEffect(() => {
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
      } catch {
        if (!cancelled) {
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
  }, []);

  useEffect(() => {
    const delayMs = getNextEnterabilityWakeUpDelayMs(dashboard.attempts, nowMs);
    if (delayMs === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [dashboard.attempts, nowMs]);

  async function submitSchedule(examId: string) {
    const scheduledFor = scheduleDrafts[examId];
    if (!scheduledFor) {
      setError("Choose a future date and time before scheduling.");
      return;
    }

    setSubmittingExamId(examId);
    setError(null);
    setColdStartNotice(null);
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
        setColdStartNotice(
          "Scheduled within five hours: CloudShare may cold-start the environment on login.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to schedule exam");
    } finally {
      setSubmittingExamId(null);
    }
  }

  function attemptForExam(examId: string) {
    return getLatestAttemptForExam(dashboard.attempts, examId);
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

  const scheduledAttempts = buildScheduledAttemptViews(dashboard, nowMs);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem 1rem 3rem",
        maxWidth: "1120px",
        margin: "0 auto",
      }}
    >
      <section
        style={{
          border: "1px solid #d9e1e8",
          borderRadius: "8px",
          padding: "1.5rem",
          background: "#f7fafc",
          marginBottom: "1.25rem",
        }}
      >
        <div style={candidateHomeHeaderStyle}>
          <div style={candidateHomeHeaderIntroStyle}>
            <p style={{ margin: 0, color: "#5f6b76", fontSize: "0.9rem", fontWeight: 600 }}>
              Certalis Candidate Portal
            </p>
            <h1 style={{ margin: "0.35rem 0 0.5rem", fontSize: "2rem" }}>Candidate Home</h1>
            <p style={{ margin: 0, color: "#334155", lineHeight: 1.5 }}>
              Review your scheduled Exams, enter or resume active sessions, and schedule the next
              published Helios CX Exam from one place.
            </p>
          </div>
          <div style={candidateHomeAccountActionsStyle}>
            <div style={candidateHomeAccountPanelStyle}>
              <p style={{ margin: 0, color: "#5f6b76", fontSize: "0.85rem" }}>Signed in as</p>
              <p style={{ margin: "0.3rem 0 0", color: "#0f172a", fontWeight: 600, overflowWrap: "anywhere" }}>
                {email}
              </p>
            </div>
            <button
              onClick={() => void logout()}
              disabled={logoutPresentation.disabled}
              style={getButtonStyle(secondaryButtonStyle, logoutPresentation.disabled)}
            >
              {logoutPresentation.buttonLabel}
            </button>
          </div>
        </div>
      </section>
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
        {loading && <p style={messagePanelStyle}>Loading candidate dashboard...</p>}
        {error && (
          <p style={{ ...messagePanelStyle, color: "#b00020", background: "#fff5f7", border: "1px solid #f1c7d0" }}>
            {error}
          </p>
        )}
        {coldStartNotice && (
          <p
            style={{ ...messagePanelStyle, color: "#7a4b00", background: "#fff8eb", border: "1px solid #f0d8a8" }}
          >
            {coldStartNotice}
          </p>
        )}
        {scheduledAttempts.length > 0 && (
          <section style={sectionPanelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Scheduled attempts</p>
                <h2 style={sectionTitleStyle}>Upcoming and active Exams</h2>
              </div>
              <p style={sectionCopyStyle}>
                Use these actions to enter when your launch window opens, resume a suspended session,
                or review a completed score.
              </p>
            </div>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {scheduledAttempts.map((attempt) => {
                const primaryAction = getAttemptPrimaryAction(
                  {
                    id: attempt.attemptId,
                    examId: attempt.examId,
                    scheduledFor: attempt.scheduledFor,
                    status: attempt.status,
                  },
                  nowMs,
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
                        <span style={statusBadgeStyle}>{formatCandidateAttemptStatus(attempt.status)}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          gap: "0.75rem",
                        }}
                      >
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>Scheduled for</span>
                          <span style={metaValueStyle}>
                            {formatCandidateScheduledDateTime(attempt.scheduledFor) ?? "TBD"}
                          </span>
                        </div>
                        <div style={metaItemStyle}>
                          <span style={metaLabelStyle}>State</span>
                          <span style={metaValueStyle}>{formatCandidateAttemptStatus(attempt.status)}</span>
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
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
        {!error && shouldShowNoPublishedExams({ loading, examCount: dashboard.exams.length }) && (
          <section style={sectionPanelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Published Exams</p>
                <h2 style={sectionTitleStyle}>Schedule your next session</h2>
              </div>
            </div>
            <p style={{ margin: 0, color: "#475569" }}>No published Exams are available yet.</p>
          </section>
        )}

        {shouldShowPublishedExamList({ loading, examCount: dashboard.exams.length }) && (
          <section style={sectionPanelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowStyle}>Published Exams</p>
                <h2 style={sectionTitleStyle}>Browse and schedule</h2>
              </div>
              <p style={sectionCopyStyle}>
                Choose a time for an available Exam. Existing attempts remain visible so you can keep
                your schedule and launch actions in view.
              </p>
            </div>
            <div style={{ display: "grid", gap: "0.9rem" }}>
              {dashboard.exams.map((exam) => {
                const attempt = attemptForExam(exam.id);
                const primaryAction = getAttemptPrimaryAction(attempt, nowMs);
                const durationLabels = buildCandidateExamDurationLabels(exam);
                return (
                  <article key={exam.id} style={cardStyle}>
                    <div style={{ display: "grid", gap: "1rem" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "1rem",
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ maxWidth: "44rem" }}>
                          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>{exam.title}</h3>
                          <p style={{ margin: "0.5rem 0 0", color: "#444", lineHeight: 1.5 }}>
                            {exam.description || "No description provided."}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <span style={pillStyle}>{durationLabels.runtimeLimit}</span>
                          <span style={pillStyle}>{durationLabels.openWindow}</span>
                        </div>
                      </div>
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
                          <span style={metaValueStyle}>
                            {getCandidateCurrentAttemptLabel(attempt)}
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
                            onChange={(event) =>
                              setScheduleDrafts((current) => ({
                                ...current,
                                [exam.id]: event.target.value,
                              }))
                            }
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
                      {attempt?.status === "ready" && getAttemptWaitingMessage(attempt, nowMs) && (
                        <p style={{ margin: 0, color: "#555", lineHeight: 1.4 }}>
                          {getAttemptWaitingMessage(attempt, nowMs)}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

const sectionPanelStyle: CSSProperties = {
  border: "1px solid #d9e1e8",
  borderRadius: "8px",
  padding: "1.25rem",
  background: "#ffffff",
};

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

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: "#5f6b76",
  fontSize: "0.8rem",
  fontWeight: 700,
  letterSpacing: 0,
  textTransform: "uppercase",
};

const cardStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "1rem",
  background: "#fcfdff",
};

const metaItemStyle: CSSProperties = {
  display: "grid",
  gap: "0.3rem",
  padding: "0.85rem 0.9rem",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  background: "#ffffff",
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

const statusBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.35rem 0.65rem",
  borderRadius: "999px",
  background: "#e8f1ff",
  color: "#1d4f91",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.35rem 0.65rem",
  borderRadius: "999px",
  background: "#eff6ff",
  color: "#1e40af",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const primaryButtonStyle: CSSProperties = {
  padding: "0.7rem 1rem",
  borderRadius: "8px",
  border: "1px solid #0f3d91",
  background: "#0f3d91",
  color: "#ffffff",
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "0.7rem 1rem",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 600,
};

const disabledButtonStyle: CSSProperties = {
  background: "#e2e8f0",
  border: "1px solid #cbd5e1",
  color: "#94a3b8",
  cursor: "not-allowed",
  boxShadow: "none",
};

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

const messagePanelStyle: CSSProperties = {
  margin: 0,
  padding: "0.95rem 1rem",
  border: "1px solid #d9e1e8",
  borderRadius: "8px",
  background: "#f8fafc",
  color: "#334155",
};
