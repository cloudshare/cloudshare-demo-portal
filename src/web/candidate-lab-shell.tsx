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

type AttemptStatus = "ready" | "in_progress" | "suspended" | "completed";

export function CandidateLabShell({
  examAttemptId,
  initialAttemptStatus,
}: {
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#52606d", fontWeight: 600 }}>
            Candidate lab
          </p>
          <h1 style={{ margin: "0.35rem 0 0.5rem", lineHeight: 1.1 }}>
            {loadingStatus ? "Loading exam details..." : presentation?.heading ?? "Exam details unavailable"}
          </h1>
          <p style={{ margin: 0, color: "#52606d", maxWidth: "48rem" }}>
            {presentation?.actionDetail ??
              (labStatus
                ? `Exam attempt: ${labStatus.examAttemptId}`
                : `Requested attempt: ${examAttemptId}`)}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => router.push("/candidate")}
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
            style={secondaryButtonStyle}
          >
            {logoutPresentation.buttonLabel}
          </button>
        </div>
      </div>
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
                border: "1px solid #d9e2ec",
                borderRadius: "8px",
                padding: "0.85rem 0.95rem",
                backgroundColor: item.label === "Status" ? "#f0fdf4" : "#f8fafc",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#52606d" }}>
                {item.label}
              </p>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.98rem", fontWeight: 600, color: "#14213d" }}>
                {item.value}
              </p>
            </div>
          ))}
        </section>
      ) : null}
      {presentation ? (
        <section
          style={{
            border: "1px solid #d9e2ec",
            borderRadius: "8px",
            backgroundColor: "#f8fafc",
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

const secondaryButtonStyle = {
  padding: "0.6rem 0.95rem",
  borderRadius: "8px",
  border: "1px solid #cbd2d9",
  backgroundColor: "#ffffff",
  color: "#14213d",
  fontWeight: 600,
} as const;
