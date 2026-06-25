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

    async function loadStatus() {
      setLoadingStatus(true);
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
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [examAttemptId]);

  const presentation = labStatus ? getCandidateLabPresentation({
    status: labStatus.status ?? initialAttemptStatus,
    examAttemptId,
    examTitle: labStatus.examTitle,
    timeLimitMinutes: labStatus.timeLimitMinutes,
    scheduledFor: labStatus.scheduledFor,
  }) : null;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.35rem" }}>
            {loadingStatus ? "Loading exam details..." : presentation?.heading ?? "Exam details unavailable"}
          </h1>
          <p style={{ margin: 0, color: "#555" }}>
            {labStatus ? `Exam attempt: ${labStatus.examAttemptId}` : `Requested attempt: ${examAttemptId}`}
          </p>
          {presentation ? (
            <p style={{ margin: "0.35rem 0 0", color: "#0b5d3b" }}>
              Status: {presentation.statusLabel}
            </p>
          ) : null}
          {presentation?.timeLimitLabel ? (
            <p style={{ margin: "0.35rem 0 0", color: "#555" }}>{presentation.timeLimitLabel}</p>
          ) : null}
          {presentation?.scheduledForLabel ? (
            <p style={{ margin: "0.35rem 0 0", color: "#555" }}>{presentation.scheduledForLabel}</p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => router.push("/candidate")} style={{ padding: "0.55rem 0.9rem" }}>
            Back to Candidate Home
          </button>
          {presentation?.showScoreLink ? (
            <button
              type="button"
              onClick={() => router.push(`/candidate/score?examAttemptId=${encodeURIComponent(examAttemptId)}`)}
              style={{ padding: "0.55rem 0.9rem" }}
            >
              View score
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            disabled={logoutPresentation.disabled}
            style={{ padding: "0.55rem 0.9rem" }}
          >
            {logoutPresentation.buttonLabel}
          </button>
        </div>
      </div>
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
          Unable to load the current exam state. Return to Candidate Home and try again. Details: {statusError}
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
