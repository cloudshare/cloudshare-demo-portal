"use client";

import React, { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  joinCandidateCohortSession, loadCandidateDashboard, scheduleCandidateExam, shouldShowNoPublishedExams, shouldShowPublishedExamList, type CandidateDashboardData,
} from "./candidate-scheduling";
import {
  COLD_START_WARNING_MESSAGE,
  getNextEnterabilityWakeUpDelayMs,
  getAttemptPrimaryAction,
} from "./candidate-home-state";
import { formatCandidateAttemptStatus } from "./candidate-lab-state";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import { useCandidateLogout } from "./candidate-logout";
import { openEnterExamWindow } from "./enter-exam";
import { pageShellStyle } from "./page-shell";
import {
  isPortalSessionExpiredError,
  startPortalSessionWatchdog,
} from "./session-expiry";
import { cardStyle, mutedPanelStyle, alertPanelStyle } from "./card-styles";
import {
  accountLogoutButtonStyle,
  primaryButtonStyle,
  disabledButtonStyle,
} from "./button-styles";
import { statusBadgeStyle, getExamAttemptStatusTone } from "./status-badge";
import { eyebrowLabelStyle } from "./design-tokens";
import { PortalPageHeader } from "./portal-page-header";
import { CandidateExamCard } from "./candidate-exam-card";
import { createPortalSessionExpiryRedirect } from "./portal-session-redirect";
import {
  buildCandidateTaskHref,
  getCandidateTaskNavigationRoute,
  parseCandidateTaskRoute,
  parseCandidateTaskSearchParams,
  resolveCandidateTaskRoute,
  type CandidateTaskRoute,
  type CandidateTaskView,
} from "./candidate-task-route";

export {
  CandidateCohortSessionOptions,
  CandidateExamCard,
  getCandidateExamCardImmediateActionReason,
  getTakeExamAvailabilitySummary,
  PublishedExamCardHeader,
} from "./candidate-exam-card";

interface CandidateHomeProps {
  readonly email: string;
  readonly initialRoute?: CandidateTaskRoute;
}

type ScheduleFeedback = {
  readonly kind: "error" | "warning";
  readonly message: string;
};

export function CandidateHome({ email, initialRoute = { task: "current", attemptId: null, examId: null } }: CandidateHomeProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTaskHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const hasLoadedResolvedRouteRef = useRef(false);
  const previousResolvedRouteKeyRef = useRef<string | null>(null);
  const previousUrlRouteKeyRef = useRef<string | null>(null);
  const [dashboard, setDashboard] = useState<CandidateDashboardData>({
    exams: [],
    attempts: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingExamId, setSubmittingExamId] = useState<string | null>(null);
  const [submittingSessionId, setSubmittingSessionId] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [scheduleFeedback, setScheduleFeedback] = useState<Record<string, ScheduleFeedback>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessionExpired, setSessionExpired] = useState(false);
  const [announcedTaskMessage, setAnnouncedTaskMessage] = useState<string | null>(null);
  const [focusedTaskHeading, setFocusedTaskHeading] = useState<CandidateTaskView | null>(null);
  const { presentation: logoutPresentation, logout } = useCandidateLogout(router);

  const handleCandidateSessionExpired = useMemo(() => createPortalSessionExpiryRedirect({
    currentPath: () => `${window.location.pathname}${window.location.search}`,
    fallbackLoginPath: "/login",
    replace: (path) => {
      setSessionExpired(true);
      setError(null);
      setScheduleFeedback({});
      router.replace(path);
    },
  }), [router]);

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
      } else {
        setRefreshing(true);
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
          setRefreshing(false);
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
      navigateToCandidateTask({
        task: "current",
        attemptId: result.attempt.id,
        examId: result.attempt.examId,
      });
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

  async function joinCohortSession(examId: string, cohortSessionId: string) {
    setSubmittingSessionId(cohortSessionId);
    setError(null);
    setScheduleFeedback((current) => {
      const next = { ...current };
      delete next[examId];
      return next;
    });
    try {
      const result = await joinCandidateCohortSession(fetch, {
        examId,
        cohortSessionId,
      });
      setDashboard((current) => ({
        ...current,
        attempts: [
          current.attempts.filter((attempt) => attempt.id !== result.attempt.id),
          result.attempt,
        ].flat(),
      }));
      setNowMs(Date.now());
      navigateToCandidateTask({
        task: "current",
        attemptId: result.attempt.id,
        examId: result.attempt.examId,
      });
      openEnterExamWindow(result.attempt.id);
      openLabConsole(result.attempt.id, result.attempt.status);
    } catch (cause) {
      if (isPortalSessionExpiredError(cause)) {
        handleCandidateSessionExpired();
        return;
      }
      setScheduleFeedback((current) => ({
        ...current,
        [examId]: {
          kind: "error",
          message:
            cause instanceof Error ? cause.message : "Failed to start cohort Exam Session",
        },
      }));
    } finally {
      setSubmittingSessionId(null);
    }
  }

  function navigateToCandidateTask(route: CandidateTaskRoute) {
    router.push(buildCandidateTaskHref(route));
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

  const candidateRoute = parseCandidateTaskSearchParams(searchParams, initialRoute);
  const resolvedRoute = resolveCandidateTaskRoute(dashboard, nowMs, candidateRoute);
  const examsById = new Map(dashboard.exams.map((exam) => [exam.id, exam]));

  const selectedAttempt = resolvedRoute.selectedAttempt;
  const selectedExam = resolvedRoute.selectedExam;
  const selectedAttemptExam =
    selectedAttempt
      ? buildCandidateAttemptExamSnapshot(selectedAttempt, examsById.get(selectedAttempt.examId) ?? null)
      : null;
  const selectedAttemptPrimaryAction = selectedAttempt
    ? getAttemptPrimaryAction(
        {
          id: selectedAttempt.attemptId,
          examId: selectedAttempt.examId,
          scheduledFor: selectedAttempt.scheduledFor,
          status: selectedAttempt.status,
        },
        nowMs,
        selectedAttemptExam,
      )
    : { label: null, disabled: false };
  const resolvedRouteKey = useMemo(
    () =>
      [
        resolvedRoute.activeTask,
        selectedAttempt?.attemptId ?? "",
        selectedExam?.id ?? "",
        resolvedRoute.notice ?? "",
      ].join(":"),
    [resolvedRoute.activeTask, resolvedRoute.notice, selectedAttempt?.attemptId, selectedExam?.id],
  );

  useEffect(() => {
    if (loading) {
      return;
    }

    const urlRouteKey = searchParams.toString();
    if (!hasLoadedResolvedRouteRef.current) {
      hasLoadedResolvedRouteRef.current = true;
      previousUrlRouteKeyRef.current = urlRouteKey;
      previousResolvedRouteKeyRef.current = resolvedRouteKey;
      return;
    }

    const routeNavigated = previousUrlRouteKeyRef.current !== urlRouteKey;
    previousUrlRouteKeyRef.current = urlRouteKey;
    if (!routeNavigated || previousResolvedRouteKeyRef.current === resolvedRouteKey) {
      previousResolvedRouteKeyRef.current = resolvedRouteKey;
      return;
    }

    previousResolvedRouteKeyRef.current = resolvedRouteKey;
    setFocusedTaskHeading(resolvedRoute.activeTask);
    setAnnouncedTaskMessage(buildCandidateTaskAnnouncement(resolvedRoute));
    activeTaskHeadingRef.current?.focus({ preventScroll: true });
  }, [loading, resolvedRoute, resolvedRouteKey, searchParams]);

  if (sessionExpired) {
    return null;
  }

  return (
    <main style={pageShellStyle}>
      <PortalPageHeader
        eyebrow="Certalis Candidate Portal"
        title="Candidate delivery"
        description="Move between your current ExamAttempt, the next published Exam you can schedule, and completed history without losing your place."
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
        {refreshing ? <p role="status" aria-live="polite" style={{ ...mutedPanelStyle, margin: 0 }}>Refreshing candidate delivery status…</p> : null}
        <section style={taskShellStyle} aria-label="Candidate delivery tasks">
          <div style={sectionHeaderStyle}>
            <div>
              <p style={eyebrowLabelStyle}>Task flow</p>
              <h2 style={sectionTitleStyle}>Stay oriented</h2>
            </div>
            <p style={sectionCopyStyle}>
              Times use your browser&apos;s local clock in ISO order. The runtime limit, open
              window, and environment retention remain separate.
            </p>
          </div>
          {announcedTaskMessage ? (
            <p
              aria-label="Candidate route status"
              role="status"
              style={{ ...mutedPanelStyle, margin: 0, padding: "0.85rem 1rem" }}
            >
              {announcedTaskMessage}
            </p>
          ) : null}
          <div style={taskTabStripStyle}>
            {resolvedRoute.tasks.map((task) => {
              const selected = task.task === resolvedRoute.activeTask;
              return (
                <button
                  key={task.task}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => navigateToCandidateTask(getCandidateTaskNavigationRoute(task.task, resolvedRoute))}
                  style={{
                    ...taskTabButtonStyle,
                    ...(selected ? selectedTaskTabButtonStyle : null),
                  }}
                >
                  <span style={taskTabLabelStyle}>{task.label}</span>
                  <span style={taskTabCountStyle}>{task.count}</span>
                </button>
              );
            })}
          </div>
          {resolvedRoute.notice ? (
            <p role="status" style={{ ...alertPanelStyle.warning, margin: 0 }}>
              {resolvedRoute.notice}
            </p>
          ) : null}
        </section>
        {loading && <p style={mutedPanelStyle}>Loading candidate dashboard...</p>}
        {error && (
          <p role="alert" style={{ ...alertPanelStyle.danger, margin: 0 }}>
            {error}
          </p>
        )}
        {(resolvedRoute.activeTask === "current" || resolvedRoute.activeTask === "history") && (
          <section style={attemptQueueSectionStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowLabelStyle}>
                  {resolvedRoute.activeTask === "current" ? "Current task" : "Attempt history"}
                </p>
                <h2
                  ref={activeTaskHeadingRef}
                  onBlur={() => setFocusedTaskHeading(null)}
                  tabIndex={-1}
                  style={{
                    ...sectionTitleStyle,
                    ...(focusedTaskHeading === resolvedRoute.activeTask
                      ? focusedTaskHeadingStyle
                      : null),
                  }}
                >
                  {resolvedRoute.activeTask === "current"
                    ? "Your current ExamAttempt"
                    : "Completed and expired attempts"}
                </h2>
              </div>
              <p style={sectionCopyStyle}>
                {resolvedRoute.activeTask === "current"
                  ? "The next valid action stays tied to the selected ExamAttempt."
                  : "Review durable result history without mixing it into the live delivery task."}
              </p>
            </div>
            {resolvedRoute.attempts.length > 1 ? (
              <div style={attemptSelectorStripStyle}>
                {resolvedRoute.attempts.map((attempt) => (
                  <button
                    key={attempt.attemptId}
                    type="button"
                    aria-current={selectedAttempt?.attemptId === attempt.attemptId ? "page" : undefined}
                    onClick={() =>
                      navigateToCandidateTask({
                        task: resolvedRoute.activeTask,
                        attemptId: attempt.attemptId,
                        examId: null,
                      })
                    }
                    style={{
                      ...attemptSelectorButtonStyle,
                      ...(selectedAttempt?.attemptId === attempt.attemptId
                        ? selectedAttemptSelectorButtonStyle
                        : null),
                    }}
                  >
                    <span style={attemptSelectorTitleStyle}>{attempt.examTitle}</span>
                    <span style={attemptSelectorMetaStyle}>
                      {formatCandidateAttemptStatus(attempt.displayStatus)} · {formatCandidateScheduledDateTime(attempt.scheduledFor) ?? "TBD"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedAttempt ? (
              <article style={attemptCardStyle}>
                <div style={attemptCardContentStyle}>
                  <div style={attemptCardAccentStyle} />
                  <div style={attemptCardHeaderStyle}>
                    <div>
                      <strong style={{ display: "block", fontSize: "1rem", color: "#0f172a" }}>
                        {selectedAttempt.examTitle}
                      </strong>
                      <p style={{ margin: "0.35rem 0 0", color: "#475569", overflowWrap: "anywhere" }}>
                        Attempt ID: {selectedAttempt.attemptId}
                      </p>
                    </div>
                    <span style={statusBadgeStyle(getExamAttemptStatusTone(selectedAttempt.displayStatus))}>
                      {formatCandidateAttemptStatus(selectedAttempt.displayStatus)}
                    </span>
                  </div>
                  <div style={attemptMetaGridStyle}>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>Access window</span>
                      <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                        {selectedAttempt.scheduledFor && selectedAttempt.scheduledEnd ? (
                          <>
                            <span>
                              Starts {formatCandidateScheduledDateTime(selectedAttempt.scheduledFor) ?? "TBD"}
                            </span>
                            <span>
                              Closes {formatCandidateScheduledDateTime(selectedAttempt.scheduledEnd) ?? "TBD"}
                              {selectedAttemptExam ? ` (${selectedAttemptExam.openPeriodMinutes} min)` : ""}
                            </span>
                          </>
                        ) : (
                          "TBD"
                        )}
                      </span>
                    </div>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>Runtime limit</span>
                      <span style={metaValueStyle}>
                        {selectedAttemptExam?.timeLimitMinutes
                          ? `${selectedAttemptExam.timeLimitMinutes} minute runtime limit`
                          : "Unavailable"}
                      </span>
                    </div>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>Open window</span>
                      <span style={metaValueStyle}>
                        {selectedAttemptExam?.openPeriodMinutes
                          ? `${selectedAttemptExam.openPeriodMinutes} minute open window`
                          : "Unavailable"}
                      </span>
                    </div>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>Environment retention</span>
                      <span style={metaValueStyle}>
                        {selectedAttemptExam?.storageLeaseMinutes
                          ? `${selectedAttemptExam.storageLeaseMinutes} minute environment retention`
                          : "Not recorded"}
                      </span>
                    </div>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>
                        {resolvedRoute.activeTask === "current"
                          ? "Next schedule available"
                          : "Retention boundary"}
                      </span>
                      <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                        {selectedAttempt.nextScheduleAvailableLabel ? (
                          <>
                            <span>{selectedAttempt.nextScheduleAvailableLabel}</span>
                            {selectedAttemptExam ? (
                              <span style={metaHintStyle}>{getScheduleAvailabilityNote(selectedAttemptExam)}</span>
                            ) : null}
                          </>
                        ) : (
                          getAttemptScheduleAvailabilityFallback(selectedAttempt.status)
                        )}
                      </span>
                    </div>
                  </div>
                  {selectedAttemptPrimaryAction.label ? (
                    <div style={attemptActionStackStyle}>
                      <button
                        onClick={() => {
                          if (selectedAttemptPrimaryAction.label === "View score") {
                            openScorePage(selectedAttempt.attemptId);
                            return;
                          }
                          openLabConsole(selectedAttempt.attemptId, selectedAttempt.status);
                        }}
                        disabled={selectedAttemptPrimaryAction.disabled}
                        style={getButtonStyle(attemptPrimaryButtonStyle, selectedAttemptPrimaryAction.disabled)}
                      >
                        {selectedAttemptPrimaryAction.label}
                      </button>
                      {selectedAttempt.waitingMessage && selectedAttempt.status === "ready" ? (
                        <span style={{ color: "#555", lineHeight: 1.4 }}>{selectedAttempt.waitingMessage}</span>
                      ) : null}
                    </div>
                  ) : (
                    <p style={mutedTaskCopyStyle}>
                      {resolvedRoute.activeTask === "current"
                        ? selectedAttempt.status === "scheduled"
                          ? "Your ExamAttempt is scheduled. We will enable entry when the server confirms the access window is open."
                          : "No live action is available for this route state."
                        : "This attempt remains here as durable history."}
                    </p>
                  )}
                  {selectedAttempt.coldStartWarning ? (
                    <p role="status" style={{ ...alertPanelStyle.warning, margin: 0 }}>
                      {selectedAttempt.coldStartWarning}
                    </p>
                  ) : null}
                </div>
              </article>
            ) : (
              <p style={{ ...mutedPanelStyle, margin: 0 }}>
                {resolvedRoute.activeTask === "current"
                  ? "No live ExamAttempt is available right now."
                  : "No completed ExamAttempt history is available yet."}
              </p>
            )}
          </section>
        )}
        {!error && resolvedRoute.activeTask === "schedule" && shouldShowNoPublishedExams({ loading, examCount: dashboard.exams.length }) && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowLabelStyle}>Published Exams</p>
                <h2
                  ref={activeTaskHeadingRef}
                  onBlur={() => setFocusedTaskHeading(null)}
                  tabIndex={-1}
                  style={{
                    ...sectionTitleStyle,
                    ...(focusedTaskHeading === "schedule" ? focusedTaskHeadingStyle : null),
                  }}
                >
                  Schedule your next session
                </h2>
              </div>
            </div>
            <p style={{ margin: 0, color: "#475569" }}>No published Exams are available yet.</p>
          </section>
        )}

        {resolvedRoute.activeTask === "schedule" && shouldShowPublishedExamList({ loading, examCount: dashboard.exams.length }) && (
          <section style={publishedExamSectionStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowLabelStyle}>Scheduling task</p>
                <h2
                  ref={activeTaskHeadingRef}
                  onBlur={() => setFocusedTaskHeading(null)}
                  tabIndex={-1}
                  style={{
                    ...sectionTitleStyle,
                    ...(focusedTaskHeading === "schedule" ? focusedTaskHeadingStyle : null),
                  }}
                >
                  Choose an exam
                </h2>
              </div>
              <p style={sectionCopyStyle}>
                {dashboard.exams.length} published {dashboard.exams.length === 1 ? "Exam" : "Exams"}
              </p>
            </div>
            {resolvedRoute.exams.length > 1 ? (
              <div style={attemptSelectorStripStyle}>
                {resolvedRoute.exams.map((exam) => (
                  <button
                    key={exam.id}
                    type="button"
                    aria-current={selectedExam?.id === exam.id ? "page" : undefined}
                    onClick={() =>
                      navigateToCandidateTask({
                        task: "schedule",
                        attemptId: null,
                        examId: exam.id,
                      })
                    }
                    style={{
                      ...attemptSelectorButtonStyle,
                      ...(selectedExam?.id === exam.id ? selectedAttemptSelectorButtonStyle : null),
                    }}
                  >
                    <span style={attemptSelectorTitleStyle}>{exam.title}</span>
                    <span style={attemptSelectorMetaStyle}>
                      {exam.timeLimitMinutes} minute runtime limit · {exam.openPeriodMinutes} minute open window
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <div style={publishedExamCardGridStyle}>
              {resolvedRoute.exams.map((exam) => {
                const attemptedSessionIds = new Set(
                  dashboard.attempts
                    .map((candidateAttempt) => candidateAttempt.cohortSessionId)
                    .filter((value): value is string => typeof value === "string" && value.length > 0),
                );
                const feedback = scheduleFeedback[exam.id] ?? null;

                return (
                  <CandidateExamCard
                    key={exam.id}
                    exam={exam}
                    attemptedSessionIds={attemptedSessionIds}
                    scheduleDraft={scheduleDrafts[exam.id] ?? ""}
                    scheduleFeedback={feedback}
                    submittingExamId={submittingExamId}
                    submittingSessionId={submittingSessionId}
                    onScheduleDraftChange={(value) => {
                      setScheduleDrafts((current) => ({
                        ...current,
                        [exam.id]: value,
                      }));
                      setScheduleFeedback((current) => {
                        const next = { ...current };
                        delete next[exam.id];
                        return next;
                      });
                    }}
                    onSchedule={() => {
                      void submitSchedule(exam.id);
                    }}
                    onStartCohortSession={(sessionId) => {
                      void joinCohortSession(exam.id, sessionId);
                    }}
                  />
                );
              })}
            </div>
          </section>
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

const focusedTaskHeadingStyle: CSSProperties = {
  outline: "3px solid #93c5fd",
  outlineOffset: "4px",
  borderRadius: "4px",
};

const sectionCopyStyle: CSSProperties = {
  margin: 0,
  color: "#475569",
  maxWidth: "40rem",
  lineHeight: 1.5,
};

const taskShellStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "1rem",
  border: "1px solid #cbd5e1",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
};

const taskTabStripStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 11rem), 1fr))",
  gap: "0.75rem",
};

const taskTabButtonStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "0.2rem",
  textAlign: "left",
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  cursor: "pointer",
  padding: "0.85rem 0.95rem",
};

const selectedTaskTabButtonStyle: CSSProperties = {
  border: "1px solid #0f766e",
  background: "#ecfdf5",
  boxShadow: "inset 0 0 0 1px rgba(15, 118, 110, 0.18)",
};

const taskTabLabelStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.82rem",
  fontWeight: 600,
};

const taskTabCountStyle: CSSProperties = {
  color: "#0f172a",
  fontSize: "1.35rem",
  fontWeight: 700,
  lineHeight: 1.1,
};

const attemptQueueSectionStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "1rem",
  background: "#ffffff",
  border: "1px solid #cbd5e1",
  borderLeft: "6px solid #0f766e",
  boxShadow: "0 4px 14px rgba(15, 23, 42, 0.08)",
};

const attemptCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 0,
  overflow: "hidden",
  border: "1px solid #dbe4ef",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
};

const attemptCardContentStyle: CSSProperties = {
  display: "grid",
  gap: "1rem",
  height: "100%",
  padding: "1.05rem",
  boxSizing: "border-box",
};

const attemptCardAccentStyle: CSSProperties = {
  height: "3px",
  borderRadius: "999px",
  background: "linear-gradient(90deg, #4f46e5 0%, #10b981 55%, #f97316 100%)",
};

const attemptCardHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  flexWrap: "wrap",
  alignItems: "flex-start",
};

const attemptMetaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: "0.75rem",
};

const attemptActionStackStyle: CSSProperties = {
  display: "grid",
  gap: "0.5rem",
  marginTop: "auto",
};

const attemptSelectorStripStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))",
  gap: "0.75rem",
};

const attemptSelectorButtonStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "0.2rem",
  textAlign: "left",
  cursor: "pointer",
  border: "1px solid #dbe4ef",
  background: "#ffffff",
  padding: "0.8rem 0.9rem",
};

const selectedAttemptSelectorButtonStyle: CSSProperties = {
  border: "1px solid #2563eb",
  background: "#eff6ff",
  boxShadow: "inset 0 0 0 1px #bfdbfe",
};

const attemptSelectorTitleStyle: CSSProperties = {
  color: "#0f172a",
  fontSize: "0.95rem",
  fontWeight: 600,
};

const attemptSelectorMetaStyle: CSSProperties = {
  color: "#64748b",
  fontSize: "0.82rem",
  lineHeight: 1.4,
};

const attemptPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  width: "100%",
  minHeight: "3.1rem",
};

const publishedExamSectionStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "1rem",
  background: "#eef6ff",
  border: "1px solid #bfdbfe",
  borderLeft: "6px solid #4f46e5",
  boxShadow: "0 4px 14px rgba(37, 99, 235, 0.1)",
};

const publishedExamCardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
  gap: "1rem",
  alignItems: "stretch",
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

const mutedTaskCopyStyle: CSSProperties = {
  margin: 0,
  color: "#475569",
  lineHeight: 1.5,
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

function getButtonStyle(baseStyle: CSSProperties, disabled: boolean): CSSProperties {
  return disabled
    ? {
        ...baseStyle,
        ...disabledButtonStyle,
      }
    : baseStyle;
}

function buildCandidateAttemptExamSnapshot(
  attempt: {
    readonly examId: string;
    readonly examTitle: string;
    readonly timeLimitMinutes: number | null;
    readonly openPeriodMinutes: number | null;
    readonly storageLeaseMinutes: number | null;
    readonly scoreRetrievalEnabled: boolean;
  },
  exam: CandidateDashboardData["exams"][number] | null,
): CandidateDashboardData["exams"][number] | null {
  if (exam) {
    return exam;
  }

  if (
    typeof attempt.examTitle !== "string" ||
    typeof attempt.timeLimitMinutes !== "number" ||
    typeof attempt.openPeriodMinutes !== "number"
  ) {
    return null;
  }

  return {
    id: attempt.examId,
    title: attempt.examTitle,
    description: "",
    timeLimitMinutes: attempt.timeLimitMinutes,
    storageLeaseMinutes: attempt.storageLeaseMinutes,
    openPeriodMinutes: attempt.openPeriodMinutes,
    scoreRetrievalEnabled: attempt.scoreRetrievalEnabled,
  };
}

function buildCandidateTaskAnnouncement(
  resolvedRoute: ReturnType<typeof resolveCandidateTaskRoute>,
): string {
  switch (resolvedRoute.activeTask) {
    case "current":
      return resolvedRoute.selectedAttempt
        ? `Now showing Current ExamAttempt. ${resolvedRoute.selectedAttempt.examTitle} is selected.`
        : "Now showing Current ExamAttempt.";
    case "history":
      return resolvedRoute.selectedAttempt
        ? `Now showing Attempt history. ${resolvedRoute.selectedAttempt.examTitle} is selected.`
        : "Now showing Attempt history.";
    case "schedule":
      return resolvedRoute.selectedExam
        ? `Now showing Schedule exam. ${resolvedRoute.selectedExam.title} is selected.`
        : "Now showing Schedule exam.";
    default:
      return "Candidate task updated.";
  }
}

