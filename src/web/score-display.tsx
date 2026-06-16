"use client";

import { useState, useEffect } from "react";
import type { ScoreResult } from "@/domain/score-result";

interface ScoreDisplayProps {
  examAttemptId: string;
}

type FetchState = "loading" | "loaded" | "error";

type ScorePayload =
  | (ScoreResult & {
      scoreRetrievalEnabled: true;
      scoreAvailable: true;
      limitations: string[];
    })
  | {
      examAttemptId: string;
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
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [score, setScore] = useState<ScorePayload | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

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
    return <p>Loading score…</p>;
  }

  if (fetchState === "error") {
    return <p role="alert">Could not load score: {errorMessage}</p>;
  }

  if (!score) return null;

  return (
    <div>
      <h2>Guided Journey score</h2>

      {score.scoreAvailable ? (
        <>
          <p>
            <strong>{score.percentComplete}%</strong> complete —{" "}
            {score.stepsCompleted} of {score.stepsTotal} tasks done
          </p>

          {score.steps.length > 0 && (
            <ul>
              {score.steps.map((step) => (
                <li key={step.stepId}>
                  {step.completed ? "✓" : "○"} {step.title}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p>{score.message}</p>
      )}

      <section aria-label="Scoring limitations">
        <h3>About this score</h3>
        <p>
          CloudShare Guided Journey scoring has the following known limitations.
        </p>
        <ul>
          {score.limitations.map((limitation, i) => (
            <li key={i}>{limitation}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
