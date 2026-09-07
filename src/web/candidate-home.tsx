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
  const hasLoadedResolvedRouteRef = useRef(false);
  const previousResolvedRouteKeyRef = useRef<string | null>(null);
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
  const [expandedAttemptDetails, setExpandedAttemptDetails] = useState<Record<string, boolean>>({});
  const pendingAttemptFocusRef = useRef<{ attemptId: string; face: "front" | "back" } | null>(null);
  const attemptFrontButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const attemptBackButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { presentation: logoutPresentation, logout } = useCandidateLogout(router);

  useEffect(() => {
    const pending = pendingAttemptFocusRef.current;
    if (!pending) return;
    const target = pending.face === "front"
      ? attemptFrontButtonRefs.current.get(pending.attemptId)
      : attemptBackButtonRefs.current.get(pending.attemptId);
    target?.focus();
    pendingAttemptFocusRef.current = null;
  }, [expandedAttemptDetails]);

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
    window.history.pushState(null, "", buildCandidateTaskHref(route));
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

  function renderAttemptCard(attempt: NonNullable<typeof selectedAttempt>) {
    const attemptExam = buildCandidateAttemptExamSnapshot(attempt, examsById.get(attempt.examId) ?? null);
    const attemptHeadingId = `candidate-attempt-${attempt.attemptId}-title`;
    const primaryAction = getAttemptPrimaryAction(
      {
        id: attempt.attemptId,
        examId: attempt.examId,
        scheduledFor: attempt.scheduledFor,
        status: attempt.status,
      },
      nowMs,
      attemptExam,
    );
    const detailsOpen = expandedAttemptDetails[attempt.attemptId] === true;
    const isOpenedAttempt = selectedAttempt?.attemptId === attempt.attemptId;
    const actionSummary = getCandidateAttemptActionSummary(attempt.status, primaryAction.label, primaryAction.disabled);
    const frontHeadingId = `${attemptHeadingId}-front`;
    const backHeadingId = `${attemptHeadingId}-back`;
    const setDetailsOpen = (open: boolean) => {
      pendingAttemptFocusRef.current = { attemptId: attempt.attemptId, face: open ? "back" : "front" };
      setExpandedAttemptDetails((current) => ({ ...current, [attempt.attemptId]: open }));
    };

    return (
      <article
        key={attempt.attemptId}
        aria-labelledby={detailsOpen ? backHeadingId : frontHeadingId}
        aria-current={isOpenedAttempt ? "true" : undefined}
        style={{
          ...attemptCardStyle,
          ...(isOpenedAttempt ? openedAttemptCardStyle : null),
        }}
      >
        <div style={attemptFlipPerspectiveStyle}>
          <div className="candidate-attempt-flip-inner" data-attempt-flip-inner="true" style={getAttemptFlipInnerStyle(detailsOpen)}>
            <section
              aria-hidden={detailsOpen}
              inert={detailsOpen ? true : undefined}
              data-attempt-card-face="front"
              style={{ ...attemptFlipFaceStyle, ...(detailsOpen ? attemptHiddenFaceStyle : null) }}
            >
              <div style={attemptFrontFaceContentStyle}>
                <div style={attemptCardAccentStyle} />
                <div data-attempt-slot="title" style={attemptTitleSlotStyle}>
                  <h3 id={frontHeadingId} style={attemptCardTitleStyle}>{attempt.examTitle}</h3>
                </div>
                <div data-attempt-slot="metadata" style={attemptMetadataSlotStyle}>
                  <div style={attemptStateBadgeStackStyle}>
                    {isOpenedAttempt
                      ? <span style={openedAttemptBadgeStyle}>Opened attempt</span>
                      : <span aria-hidden="true" style={attemptInvisibleBadgeSlotStyle} />}
                    <span style={statusBadgeStyle(getExamAttemptStatusTone(attempt.displayStatus))}>
                      {formatCandidateAttemptStatus(attempt.displayStatus)}
                    </span>
                  </div>
                  <div style={attemptDurationBadgeStackStyle}>
                    <span style={statusBadgeStyle("info")}>{attemptExam?.timeLimitMinutes ? `${attemptExam.timeLimitMinutes} minute runtime limit` : "Runtime limit unavailable"}</span>
                    <span style={statusBadgeStyle("info")}>{attemptExam?.openPeriodMinutes ? `${attemptExam.openPeriodMinutes} minute open window` : "Open window unavailable"}</span>
                  </div>
                </div>
                <div data-attempt-slot="next-step" style={attemptNextStepSlotStyle}>
                  <div style={attemptAvailabilityBandStyle}>
                    <span style={attemptAvailabilityLabelStyle}>What happens next</span>
                    <strong>{actionSummary}</strong>
                  </div>
                  {attempt.waitingMessage && attempt.status === "ready" ? <p style={attemptSupplementalMessageStyle}>{attempt.waitingMessage}</p> : null}
                  {attempt.coldStartWarning ? <p role="status" style={{ ...alertPanelStyle.warning, margin: 0 }}>{attempt.coldStartWarning}</p> : null}
                </div>
                <div data-attempt-slot="scheduled-for" style={attemptScheduledSlotStyle}>
                  {attempt.scheduledFor ? (
                    <p style={attemptDateStyle}>
                      <span style={metaLabelStyle}>Scheduled for</span>
                      <span>{formatCandidateScheduledDateTime(attempt.scheduledFor) ?? "TBD"}</span>
                    </p>
                  ) : <div aria-hidden="true" />}
                </div>
                <div data-attempt-slot="footer" style={attemptActionStackStyle}>
                  {primaryAction.label ? (
                    <button
                      aria-label={`${primaryAction.label} for ${attempt.examTitle}, attempt ${attempt.attemptId}`}
                      onClick={() => {
                        if (primaryAction.label === "View score") {
                          openScorePage(attempt.attemptId);
                          return;
                        }
                        openLabConsole(attempt.attemptId, attempt.status);
                      }}
                      disabled={primaryAction.disabled}
                      tabIndex={detailsOpen ? -1 : undefined}
                      style={getButtonStyle(attemptPrimaryButtonStyle, primaryAction.disabled)}
                    >
                      {primaryAction.label}
                    </button>
                  ) : <div aria-hidden="true" style={attemptPrimaryActionPlaceholderStyle} />}
                  <button
                    ref={(node) => {
                      if (node) attemptFrontButtonRefs.current.set(attempt.attemptId, node);
                      else attemptFrontButtonRefs.current.delete(attempt.attemptId);
                    }}
                    type="button"
                    aria-expanded={detailsOpen}
                    aria-label={`Attempt details for ${attempt.examTitle}, attempt ${attempt.attemptId}`}
                    tabIndex={detailsOpen ? -1 : undefined}
                    onClick={() => setDetailsOpen(true)}
                    style={attemptSecondaryButtonStyle}
                  >
                    Attempt details
                  </button>
                </div>
              </div>
            </section>
            <section
              aria-hidden={!detailsOpen}
              inert={!detailsOpen ? true : undefined}
              data-attempt-card-face="back"
              style={{
                ...attemptFlipFaceStyle,
                ...attemptFlipBackFaceStyle,
                ...(!detailsOpen ? attemptHiddenFaceStyle : null),
              }}
            >
              <div style={attemptBackFaceContentStyle}>
                <div style={attemptCardAccentStyle} />
                <div data-attempt-face-scroll="true" style={attemptDetailsScrollStyle}>
                  <section aria-label={`Attempt details for ${attempt.examTitle}, attempt ${attempt.attemptId}`} style={attemptDetailsPanelStyle}>
                    <h3 id={backHeadingId} style={attemptCardTitleStyle}>{attempt.examTitle}</h3>
                  <p style={attemptDetailIdentifierStyle}>Attempt ID: {attempt.attemptId}</p>
                  <div style={attemptMetaGridStyle}>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>Access window</span>
                      <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                        {attempt.scheduledFor && attempt.scheduledEnd ? (
                          <>
                            <span>Starts {formatCandidateScheduledDateTime(attempt.scheduledFor) ?? "TBD"}</span>
                            <span>Closes {formatCandidateScheduledDateTime(attempt.scheduledEnd) ?? "TBD"}{attemptExam ? ` (${attemptExam.openPeriodMinutes} min)` : ""}</span>
                          </>
                        ) : "TBD"}
                      </span>
                    </div>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>Environment retention</span>
                      <span style={metaValueStyle}>{attemptExam?.storageLeaseMinutes ? `${attemptExam.storageLeaseMinutes} minute environment retention` : "Not recorded"}</span>
                    </div>
                    <div style={metaItemStyle}>
                      <span style={metaLabelStyle}>{resolvedRoute.activeTask === "current" ? "Next schedule available" : "Retention boundary"}</span>
                      <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                        {attempt.nextScheduleAvailableLabel ? (
                          <><span>{attempt.nextScheduleAvailableLabel}</span>{attemptExam ? <span style={metaHintStyle}>{getScheduleAvailabilityNote(attemptExam)}</span> : null}</>
                        ) : getAttemptScheduleAvailabilityFallback(attempt.status)}
                      </span>
                    </div>
                  </div>
                  </section>
                </div>
                <div data-attempt-slot="footer" style={attemptActionStackStyle}>
                <div aria-hidden="true" style={attemptPrimaryActionPlaceholderStyle} />
                  <button
                    ref={(node) => {
                      if (node) attemptBackButtonRefs.current.set(attempt.attemptId, node);
                      else attemptBackButtonRefs.current.delete(attempt.attemptId);
                    }}
                    type="button"
                    aria-expanded={detailsOpen}
                    aria-label={`Back to attempt for ${attempt.examTitle}, attempt ${attempt.attemptId}`}
                    tabIndex={!detailsOpen ? -1 : undefined}
                    onClick={() => setDetailsOpen(false)}
                    style={attemptSecondaryButtonStyle}
                  >
                    Back to attempt
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </article>
    );
  }
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

    if (!hasLoadedResolvedRouteRef.current) {
      hasLoadedResolvedRouteRef.current = true;
      previousResolvedRouteKeyRef.current = resolvedRouteKey;
      return;
    }

    const resolvedRouteChanged = previousResolvedRouteKeyRef.current !== resolvedRouteKey;
    if (!resolvedRouteChanged) {
      previousResolvedRouteKeyRef.current = resolvedRouteKey;
      return;
    }

    previousResolvedRouteKeyRef.current = resolvedRouteKey;
    setAnnouncedTaskMessage(buildCandidateTaskAnnouncement(resolvedRoute));
  }, [loading, resolvedRoute, resolvedRouteKey, searchParams]);

  if (sessionExpired) {
    return null;
  }

  return (
    <main style={pageShellStyle}>
      <PortalPageHeader
        eyebrow="Certalis Candidate Portal"
        title="Candidate delivery"
        description="Move between your current Exam Attempt, the next published Exam you can schedule, and completed history without losing your place."
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
        <p
          aria-label="Candidate delivery refresh status"
          aria-live="polite"
          role="status"
          style={visuallyHiddenStyle}
        >
          {refreshing ? "Refreshing candidate delivery status…" : ""}
        </p>
        <p
          aria-hidden="true"
          data-candidate-refresh-visual="true"
          style={{
            ...refreshStatusSlotStyle,
            visibility: refreshing ? "visible" : "hidden",
          }}
        >
          {refreshing ? "Refreshing candidate delivery status…" : ""}
        </p>
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
                <h2 style={sectionTitleStyle}>
                  {resolvedRoute.activeTask === "current"
                    ? "Your current Exam Attempt"
                    : "Completed and expired attempts"}
                </h2>
              </div>
              <p style={sectionCopyStyle}>
                {resolvedRoute.activeTask === "current"
                  ? "Each Exam Attempt keeps its own status, timing, and next valid action."
                  : "Review durable result history without mixing it into the live delivery task."}
              </p>
            </div>
            {resolvedRoute.attempts.length > 0 ? (
              <div style={attemptCardListStyle}>
                {resolvedRoute.attempts.map(renderAttemptCard)}
              </div>
            ) : (
              <p style={{ ...mutedPanelStyle, margin: 0 }}>
                {resolvedRoute.activeTask === "current"
                  ? "No live Exam Attempt is available right now."
                  : "No completed Exam Attempt history is available yet."}
              </p>
            )}
          </section>
        )}
        {!error && resolvedRoute.activeTask === "schedule" && shouldShowNoPublishedExams({ loading, examCount: dashboard.exams.length }) && (
          <section style={cardStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <p style={eyebrowLabelStyle}>Published Exams</p>
                <h2 style={sectionTitleStyle}>
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
                <h2 style={sectionTitleStyle}>
                  Choose an exam
                </h2>
              </div>
              <p style={sectionCopyStyle}>
                {dashboard.exams.length} published {dashboard.exams.length === 1 ? "Exam" : "Exams"}
              </p>
            </div>
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

const refreshStatusSlotStyle: CSSProperties = {
  height: "2.75rem",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  padding: "0.65rem 0.85rem",
  margin: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  background: "#f8fafc",
  color: "#475569",
  fontSize: "0.875rem",
};

const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
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
  height: "34rem",
  padding: 0,
  overflow: "hidden",
  border: "1px solid #dbe4ef",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
};

function getAttemptFlipInnerStyle(detailsOpen: boolean): CSSProperties {
  return {
    display: "grid",
    position: "relative",
    height: "100%",
    transformStyle: "preserve-3d",
    transform: detailsOpen ? "rotateY(180deg)" : "rotateY(0deg)",
  };
}

const attemptFlipPerspectiveStyle: CSSProperties = {
  perspective: "1200px",
  height: "100%",
};

const attemptFlipFaceStyle: CSSProperties = {
  gridArea: "1 / 1",
  position: "absolute",
  inset: 0,
  backfaceVisibility: "hidden",
  WebkitBackfaceVisibility: "hidden",
  minWidth: 0,
};

const attemptFlipBackFaceStyle: CSSProperties = {
  transform: "rotateY(180deg)",
};

const attemptHiddenFaceStyle: CSSProperties = {
  pointerEvents: "none",
};

const attemptFrontFaceContentStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "3px 3.8rem 5.5rem 7rem 2.75rem 6.7rem",
  gap: "0.9rem",
  height: "100%",
  padding: "1.05rem",
  boxSizing: "border-box",
};

const attemptBackFaceContentStyle: CSSProperties = {
  ...attemptFrontFaceContentStyle,
  gridTemplateRows: "3px minmax(0, 1fr) 6.7rem",
};

const attemptTitleSlotStyle: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  paddingRight: "0.15rem",
};

const attemptMetadataSlotStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: "0.75rem",
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
};

const attemptStateBadgeStackStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  justifyItems: "start",
  gap: "0.4rem",
};

const attemptDurationBadgeStackStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  justifyItems: "end",
  gap: "0.4rem",
};

const attemptInvisibleBadgeSlotStyle: CSSProperties = {
  ...statusBadgeStyle("info"),
  background: "#ecfdf5",
  color: "#0f766e",
  visibility: "hidden",
};

const attemptNextStepSlotStyle: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  paddingRight: "0.15rem",
};

const attemptScheduledSlotStyle: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
};

const attemptDetailsScrollStyle: CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  paddingRight: "0.2rem",
};

const openedAttemptCardStyle: CSSProperties = {
  borderColor: "#0f766e",
  boxShadow: "0 0 0 1px rgba(15, 118, 110, 0.18), 0 1px 2px rgba(15, 23, 42, 0.08)",
};

const attemptCardAccentStyle: CSSProperties = {
  height: "3px",
  borderRadius: "999px",
  background: "linear-gradient(90deg, #4f46e5 0%, #10b981 55%, #f97316 100%)",
};

const attemptCardTitleStyle: CSSProperties = {
  display: "block",
  margin: 0,
  fontSize: "1.1rem",
  color: "#0f172a",
  overflowWrap: "anywhere",
};

const openedAttemptBadgeStyle: CSSProperties = {
  ...statusBadgeStyle("info"),
  background: "#ecfdf5",
  color: "#0f766e",
};

const attemptCardListStyle: CSSProperties = {
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
  alignItems: "start",
};

const attemptAvailabilityBandStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: "0.2rem",
  padding: "0.8rem",
  border: "1px solid #dbeafe",
  borderRadius: "8px",
  background: "#eff6ff",
};

const attemptAvailabilityLabelStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.78rem",
  fontWeight: 700,
  textTransform: "uppercase",
};

const attemptDateStyle: CSSProperties = {
  display: "grid",
  gap: "0.25rem",
  margin: 0,
  color: "#0f172a",
};

const attemptSupplementalMessageStyle: CSSProperties = {
  margin: 0,
  color: "#475569",
  lineHeight: 1.4,
};

const attemptDetailsPanelStyle: CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  paddingTop: "0.15rem",
};

const attemptDetailIdentifierStyle: CSSProperties = {
  margin: 0,
  color: "#475569",
  overflowWrap: "anywhere",
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

const attemptPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  width: "100%",
  minHeight: "3.1rem",
};

const attemptPrimaryActionPlaceholderStyle: CSSProperties = {
  minHeight: "3.1rem",
};

const attemptSecondaryButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: "3.1rem",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 600,
  fontSize: "0.95rem",
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

function getCandidateAttemptActionSummary(
  status: CandidateDashboardData["attempts"][number]["status"],
  action: "Enter exam" | "Return to exam" | "Resume exam" | "View score" | null,
  disabled: boolean,
): string {
  if (action === "Enter exam") return disabled
    ? "Your Exam Attempt is scheduled. We will enable entry when the access window opens."
    : "Ready to start";
  if (action === "Return to exam") return "Exam in progress";
  if (action === "Resume exam") return "Ready to resume";
  if (action === "View score") return "Score available";
  if (status === "scheduled" || status === "ready") {
    return "Your Exam Attempt is scheduled. We will enable entry when the access window opens.";
  }
  if (status === "completed") return "This attempt is saved in your history.";
  if (status === "expired") return "This attempt is saved in your history.";
  return "No action is available right now.";
}

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
      return "Now showing Current Exam Attempt.";
    case "history":
      return "Now showing Attempt history.";
    case "schedule":
      return "Now showing Schedule exam. Choose a published Exam below.";
    default:
      return "Candidate task updated.";
  }
}
