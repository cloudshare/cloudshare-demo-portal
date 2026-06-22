"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ScoreResult } from "@/domain/score-result";
import { getCandidateScorePresentation } from "./candidate-score-state";

interface ScoreDisplayProps {
  examAttemptId: string;
}

type FetchState = "loading" | "loaded" | "error";

type ScorePayload =
  | (ScoreResult & {
      examTitle: string;
      scheduledFor: string | null;
      scoreRetrievalEnabled: true;
      scoreAvailable: true;
      limitations: string[];
    })
  | {
      examAttemptId: string;
      examTitle: string;
      scheduledFor: string | null;
      experienceId: string;
      scoreRetrievalEnabled: boolean;
      scoreAvailable: false;
      reason: "score_retrieval_disabled" | "no_guided_journey_score";
      message: string;
      retrievedAt: string;
      limitations: string[];
    };

/**
 * Fetches and renders the candidate's Guided Journey score for a completed exam
 * attempt. Surfaces CloudShare's current scoring limitations inline so the
 * candidate (and any proctor viewing the demo) understands the scope of what is
 * and is not captured.
 */
export function ScoreDisplay({ examAttemptId }: ScoreDisplayProps) {
  const router = useRouter();
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [score, setScore] = useState<ScorePayload | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/exam/score?examAttemptId=${encodeURIComponent(examAttemptId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            correlationId?: string;
          };
          const detail = body.error ?? `request failed (${res.status})`;
          throw new Error(
            body.correlationId
              ? `${detail}. Reference: ${body.correlationId}`
              : detail,
          );
        }
        return res.json() as Promise<ScorePayload>;
      })
      .then((data) => {
        if (cancelled || !data) return;
        setScore(data);
        setFetchState("loaded");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "unknown error");
        setFetchState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [examAttemptId]);

  if (fetchState === "loading") {
    return <p style={{ margin: 0 }}>Loading score…</p>;
  }

  if (fetchState === "error") {
    return (
      <section
        style={{
          display: "grid",
          gap: "1rem",
          border: "1px solid #e5e7eb",
          borderRadius: "10px",
          padding: "1.25rem",
          background: "#fff",
        }}
      >
        <p role="alert" style={{ margin: 0, color: "#b00020" }}>
          Could not load score: {errorMessage}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => router.push("/candidate")} style={{ padding: "0.55rem 0.9rem" }}>
            Back to Candidate Home
          </button>
          <button type="button" onClick={() => void logout()} style={{ padding: "0.55rem 0.9rem" }}>
            Log out
          </button>
        </div>
      </section>
    );
  }

  if (!score) return null;

  const presentation = getCandidateScorePresentation({
    examAttemptId: score.examAttemptId,
    examTitle: score.examTitle,
    scheduledFor: score.scheduledFor,
  });

  return (
    <section
      style={{
        display: "grid",
        gap: "1.25rem",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
        padding: "1.25rem",
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{presentation.heading}</h2>
          <p style={{ margin: "0.35rem 0 0", color: "#555" }}>{presentation.supportDetail}</p>
          {presentation.scheduledForLabel ? (
            <p style={{ margin: "0.35rem 0 0", color: "#555" }}>{presentation.scheduledForLabel}</p>
          ) : null}
          <p style={{ margin: "0.35rem 0 0", color: "#555" }}>
            Review the recorded CloudShare progress for this completed exam attempt.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={() => router.push("/candidate")} style={{ padding: "0.55rem 0.9rem" }}>
            Back to Candidate Home
          </button>
          <button type="button" onClick={() => void logout()} style={{ padding: "0.55rem 0.9rem" }}>
            Log out
          </button>
        </div>
      </div>

      {score.scoreAvailable ? (
        <>
          <p style={{ margin: 0 }}>
            <strong>{score.percentComplete}%</strong> sections explored, passed, or otherwise completed
          </p>
          <p style={{ margin: 0, color: "#333" }}>
            {score.stepsCompleted} of {score.stepsTotal} sections are currently marked explored or complete.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {[
              ["Passed rate", score.passedRate],
              ["Failed rate", score.failedRate],
              ["Explored rate", score.exploredRate],
              ["In progress rate", score.inProgressRate],
              ["Not started rate", score.notStartedRate],
              ["Not initiated rate", score.notInitiatedRate],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{ border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.75rem", background: "#fafafa" }}
              >
                <div style={{ fontSize: "0.9rem", color: "#555" }}>{label}</div>
                <div style={{ fontSize: "1.15rem", fontWeight: 600 }}>{formatRate(value as number)}</div>
              </div>
            ))}
          </div>

          {score.steps.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {score.steps.map((step) => (
                <li key={step.stepId} style={{ marginBottom: "0.35rem" }}>
                  {step.completed ? "✓" : "○"} {step.title}
                  {step.status ? ` (${step.status})` : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p style={{ margin: 0 }}>{score.message}</p>
      )}

      <section
        aria-label="Scoring limitations"
        style={{ display: "grid", gap: "0.75rem", padding: "1rem", borderRadius: "8px", background: "#f8fafc" }}
      >
        <h3 style={{ margin: 0 }}>About this score</h3>
        <p style={{ margin: 0 }}>
          CloudShare Guided Journey scoring has the following known limitations.
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {score.limitations.map((limitation, i) => (
            <li key={i} style={{ marginBottom: "0.35rem" }}>{limitation}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
