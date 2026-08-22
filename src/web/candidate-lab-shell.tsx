"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LabLauncher } from "./lab-launcher";
import { getCandidateLabPresentation } from "./candidate-lab-state";
import { loadCandidateLabStatus, type CandidateLabStatus } from "./lab-launcher-client";
import {
  updateCandidateLabStatus,
  updateCandidateLabStatusAttemptState,
} from "./lab-launcher-state";
import { useCandidateLogout } from "./candidate-logout";
import { pageShellStyle } from "./page-shell";
import { cardStyle, mutedPanelStyle } from "./card-styles";
import { accountLogoutButtonStyle, disabledButtonStyle, secondaryButtonStyle } from "./button-styles";
import { statusBadgeStyle, getExamAttemptStatusTone } from "./status-badge";
import { PortalPageHeader } from "./portal-page-header";
import { buildCandidateTaskHref, getCandidateTaskForAttemptStatus } from "./candidate-task-route";

type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";

export function CandidateLabShell({
  email,
  examAttemptId,
  initialAttemptStatus,
}: {
  readonly email: string;
  readonly examAttemptId: string;
  readonly initialAttemptStatus: AttemptStatus;
}) {
  const router = useRouter();
  const [labStatus, setLabStatus] = useState<CandidateLabStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const { presentation: logoutPresentation, logout } = useCandidateLogout(router);

  useEffect(() => {
    let cancelled = false;
    let refreshInFlight = false;

    async function loadStatus(showLoading = false) {
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      if (showLoading) {
        setLoadingStatus(true);
      }
      setStatusError(null);
      try {
        const status = await loadCandidateLabStatus(fetch, examAttemptId);
        if (!cancelled) {
          setLabStatus(status);
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(
            error instanceof Error ? error.message : "Failed to load exam details.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingStatus(false);
        }
        refreshInFlight = false;
      }
    }

    function refreshIfVisible() {
      if (document.visibilityState === "visible") {
        void loadStatus();
      }
    }

    void loadStatus(true);
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 15_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [examAttemptId]);

  const presentation = labStatus ? getCandidateLabPresentation({
    status: labStatus.status ?? initialAttemptStatus,
    examAttemptId,
    examTitle: labStatus.examTitle,
    timeLimitMinutes: labStatus.timeLimitMinutes,
    scheduledFor: labStatus.scheduledFor,
    openPeriodEndsAt: labStatus.openPeriodEndsAt ?? null,
    openPeriodClosed: labStatus.openPeriodClosed === true,
  }) : null;

  return (
    <main style={{ ...pageShellStyle, color: "#14213d" }}>
      <PortalPageHeader
        eyebrow="Candidate lab"
        title={loadingStatus ? "Loading exam details..." : presentation?.heading ?? "Exam details unavailable"}
        description={
          presentation?.supportDetail ??
          (labStatus
            ? `Exam attempt: ${labStatus.examAttemptId}`
            : `Requested attempt: ${examAttemptId}`)
        }
        email={email}
        actions={
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() =>
                router.push(
                  buildCandidateTaskHref({
                    task: getCandidateTaskForAttemptStatus(labStatus?.status ?? initialAttemptStatus),
                    attemptId: examAttemptId,
                    examId: null,
                  }),
                )
              }
              style={secondaryButtonStyle}
            >
              Back to Candidate Home
            </button>
            {presentation?.showScoreLink ? (
              <button
                type="button"
                onClick={() => router.push(`/candidate/score?examAttemptId=${encodeURIComponent(examAttemptId)}`)}
                style={secondaryButtonStyle}
              >
                View score
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void logout()}
              disabled={logoutPresentation.disabled}
              style={getLogoutButtonStyle(logoutPresentation.disabled)}
            >
              {logoutPresentation.buttonLabel}
            </button>
          </div>
        }
      />
      {presentation ? (
        <section
          aria-label="Exam attempt summary"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          {presentation.summaryItems.map((item) => (
            <div
              key={item.label}
              style={{
                ...cardStyle,
                padding: "0.85rem 0.95rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#52606d" }}>
                {item.label}
              </p>
              {item.label === "Status" ? (
                <p style={{ margin: "0.35rem 0 0" }}>
                  <span style={statusBadgeStyle(getExamAttemptStatusTone(labStatus?.status ?? initialAttemptStatus))}>
                    {item.value}
                  </span>
                </p>
              ) : (
                <p style={{ margin: "0.35rem 0 0", fontSize: "0.98rem", fontWeight: 600, color: "#14213d" }}>
                  {item.value}
                </p>
              )}
            </div>
          ))}
        </section>
      ) : null}
      {presentation && (labStatus?.status ?? initialAttemptStatus) !== "ready" ? (
        <section
          style={{
            ...mutedPanelStyle,
            padding: "1rem 1.1rem",
            marginBottom: "1rem",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#52606d" }}>
            Current action
          </p>
          <h2 style={{ margin: "0.35rem 0 0.45rem", fontSize: "1.15rem" }}>{presentation.actionTitle}</h2>
          <p style={{ margin: 0, color: "#334e68" }}>{presentation.actionDetail}</p>
        </section>
      ) : null}
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
      {statusError ? (
        <p role="alert" style={{ marginTop: 0, marginBottom: "1rem", color: "#b00020" }}>
          Unable to load the current exam state. {statusError}
        </p>
      ) : null}
      {presentation?.notice ? (
        <p style={{ marginTop: 0, marginBottom: "1rem", color: "#0b5d3b" }}>{presentation.notice}</p>
      ) : null}
      {loadingStatus ? <p style={{ marginTop: 0 }}>Loading exam details...</p> : null}
      {!loadingStatus && !statusError && labStatus ? (
        <LabLauncher
          examAttemptId={examAttemptId}
          currentAttemptStatus={labStatus.status ?? initialAttemptStatus}
          openPeriodClosed={labStatus.openPeriodClosed === true}
          onAttemptStatusChange={(status) =>
            setLabStatus((current) => updateCandidateLabStatusAttemptState(current, status))
          }
          onLabStatusLoaded={(status) =>
            setLabStatus((current) => updateCandidateLabStatus(current, status))
          }
        />
      ) : null}
    </main>
  );
}

function getLogoutButtonStyle(disabled: boolean) {
  return disabled
    ? {
        ...accountLogoutButtonStyle,
        ...disabledButtonStyle,
      }
    : accountLogoutButtonStyle;
}
