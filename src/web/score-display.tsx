"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ScoreResult } from "@/domain/score-result";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import { getCandidateScorePresentation } from "./candidate-score-state";
import type { CandidateLogoutPresentation } from "./candidate-logout";
import { useCandidateLogout } from "./candidate-logout";
import { cardStyle, mutedPanelStyle } from "@/web/card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "@/web/button-styles";
import { eyebrowLabelStyle } from "@/web/design-tokens";
import { statusBadgeStyle } from "@/web/status-badge";

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

interface ScorePanelActionProps {
  readonly logoutPresentation: CandidateLogoutPresentation;
  readonly onBackToCandidateHome: () => void;
  readonly onLogout: () => void | Promise<void>;
}

/**
 * Fetches and renders the candidate's Guided Journey score for a completed exam
 * attempt. Surfaces CloudShare's current scoring limitations inline so the
 * Candidate and support viewers understand the scope of what is
 * and is not captured.
 */
export function ScoreDisplay({ examAttemptId }: ScoreDisplayProps) {
  const router = useRouter();
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [score, setScore] = useState<ScorePayload | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const { presentation: logoutPresentation, logout } = useCandidateLogout(router);

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
      <ScoreErrorPanel
        errorMessage={errorMessage}
        logoutPresentation={logoutPresentation}
        onBackToCandidateHome={() => router.push("/candidate")}
        onLogout={() => void logout()}
      />
    );
  }

  if (!score) return null;

  const presentation = getCandidateScorePresentation({
    examAttemptId: score.examAttemptId,
    examTitle: score.examTitle,
    scheduledFor: score.scheduledFor,
  });

  return (
    <ScoreLoadedPanel
      score={score}
      logoutPresentation={logoutPresentation}
      onBackToCandidateHome={() => router.push("/candidate")}
      onLogout={() => void logout()}
      presentation={presentation}
    />
  );
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ScoreLoadedPanel({
  score,
  logoutPresentation,
  onBackToCandidateHome,
  onLogout,
  presentation = getCandidateScorePresentation({
    examAttemptId: score.examAttemptId,
    examTitle: score.examTitle,
    scheduledFor: score.scheduledFor,
  }),
}: {
  readonly score: ScorePayload;
  readonly logoutPresentation: CandidateLogoutPresentation;
  readonly onBackToCandidateHome: () => void;
  readonly onLogout: () => void | Promise<void>;
  readonly presentation?: ReturnType<typeof getCandidateScorePresentation>;
}) {
  return (
    <section style={cardStyle}>
      <div style={headerLayoutStyle}>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <p style={eyebrowLabelStyle}>Completion summary</p>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <h2 style={{ margin: 0 }}>{presentation.heading}</h2>
            <p style={supportTextStyle}>{presentation.supportDetail}</p>
            {presentation.scheduledForLabel ? (
              <p style={supportTextStyle}>{presentation.scheduledForLabel}</p>
            ) : null}
          </div>
          <p style={{ margin: 0, color: "#334155" }}>
            Review the recorded CloudShare Guided Journey result for this completed ExamAttempt.
          </p>
        </div>
        <ScorePanelActions
          logoutPresentation={logoutPresentation}
          onBackToCandidateHome={onBackToCandidateHome}
          onLogout={onLogout}
        />
      </div>

      {logoutPresentation.statusMessage ? (
        <p role="status" style={supportTextStyle}>
          {logoutPresentation.statusMessage}
        </p>
      ) : null}
      {logoutPresentation.errorMessage ? (
        <p role="alert" style={errorTextStyle}>
          {logoutPresentation.errorMessage}
        </p>
      ) : null}

      {score.scoreAvailable ? (
        <>
          <section style={mutedPanelStyle}>
            <div style={{ display: "grid", gap: "0.4rem" }}>
              <p style={eyebrowLabelStyle}>Result summary</p>
              <h3 style={{ margin: 0, fontSize: "1.8rem", lineHeight: 1.1 }}>
                {score.percentComplete}% complete
              </h3>
              <p style={{ margin: 0, color: "#1e293b" }}>
                {score.stepsCompleted} of {score.stepsTotal} Guided Journey steps are marked explored or complete.
              </p>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <SummaryStat label="Steps completed" value={`${score.stepsCompleted} of ${score.stepsTotal}`} />
              <SummaryStat label="Passed rate" value={formatRate(score.passedRate)} />
              <SummaryStat label="Last retrieved" value={formatRetrievedAt(score.retrievedAt)} />
            </div>
          </section>

          <section style={{ display: "grid", gap: "0.75rem" }}>
            <div>
              <h3 style={{ margin: 0 }}>Metric tiles</h3>
              <p style={{ margin: "0.35rem 0 0", color: "#475569" }}>
                Compare how CloudShare marked each Guided Journey state for this attempt.
              </p>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {[
                { label: "Passed rate", value: score.passedRate },
                { label: "Failed rate", value: score.failedRate },
                { label: "Explored rate", value: score.exploredRate },
                { label: "In progress rate", value: score.inProgressRate },
                { label: "Not started rate", value: score.notStartedRate },
                { label: "Not initiated rate", value: score.notInitiatedRate },
              ].map(({ label, value }) => (
                <SummaryStat key={label} label={label} value={formatRate(value)} />
              ))}
            </div>
          </section>

          {score.steps.length > 0 ? (
            <section style={{ display: "grid", gap: "0.75rem" }}>
              <div>
                <h3 style={{ margin: 0 }}>Step progress</h3>
                <p style={{ margin: "0.35rem 0 0", color: "#475569" }}>
                  CloudShare records the final state of each Guided Journey step listed below.
                </p>
              </div>
              <ol
                style={{
                  display: "grid",
                  gap: "0.75rem",
                  margin: 0,
                  paddingLeft: "1.25rem",
                }}
              >
                {score.steps.map((step) => (
                  <li key={step.stepId} style={{ paddingLeft: "0.25rem" }}>
                    <div style={cardStyle}>
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{step.title}</strong>
                        <span style={{ color: "#475569" }}>
                          {step.completed ? "Completed" : "Not completed"}
                        </span>
                      </div>
                      {step.status ? (
                        <span style={statusBadgeStyle(step.completed ? "positive" : "neutral")}>
                          {step.status}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : (
        <section style={mutedPanelStyle}>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            <p style={eyebrowLabelStyle}>Result summary</p>
            <h3 style={{ margin: 0 }}>No score available</h3>
            <p style={{ margin: 0, color: "#1e293b" }}>{score.message}</p>
          </div>
        </section>
      )}

      <section aria-label="Scoring limitations" style={mutedPanelStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <h3 style={{ margin: 0 }}>Scoring limitations</h3>
          <p style={{ margin: 0, color: "#334155" }}>
            CloudShare Guided Journey scoring has the following known limitations.
          </p>
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: "0.45rem" }}>
          {score.limitations.map((limitation, i) => (
            <li key={i}>{limitation}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}

export function ScoreErrorPanel({
  errorMessage,
  logoutPresentation,
  onBackToCandidateHome,
  onLogout,
}: ScorePanelActionProps & { readonly errorMessage: string }) {
  return (
    <section style={cardStyle}>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <p style={eyebrowLabelStyle}>Completion summary</p>
        <h2 style={{ margin: 0 }}>Score unavailable</h2>
        <p role="alert" style={errorTextStyle}>
          Could not load score: {errorMessage}
        </p>
      </div>
      <ScorePanelActions
        logoutPresentation={logoutPresentation}
        onBackToCandidateHome={onBackToCandidateHome}
        onLogout={onLogout}
      />
      {logoutPresentation.statusMessage ? (
        <p role="status" style={supportTextStyle}>
          {logoutPresentation.statusMessage}
        </p>
      ) : null}
      {logoutPresentation.errorMessage ? (
        <p role="alert" style={errorTextStyle}>
          {logoutPresentation.errorMessage}
        </p>
      ) : null}
    </section>
  );
}

function ScorePanelActions({
  logoutPresentation,
  onBackToCandidateHome,
  onLogout,
}: ScorePanelActionProps) {
  return (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
      <button type="button" onClick={onBackToCandidateHome} style={secondaryButtonStyle}>
        Back to Candidate Home
      </button>
      <button
        type="button"
        onClick={() => void onLogout()}
        disabled={logoutPresentation.disabled}
        style={primaryButtonStyle}
      >
        {logoutPresentation.buttonLabel}
      </button>
    </div>
  );
}

function SummaryStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={cardStyle}>
      <span style={{ color: "#475569", fontSize: "0.9rem" }}>{label}</span>
      <strong style={{ fontSize: "1.15rem", lineHeight: 1.2 }}>{value}</strong>
    </div>
  );
}

function formatRetrievedAt(retrievedAt: string): string {
  return formatCandidateScheduledDateTime(retrievedAt) ?? "Unavailable";
}

const headerLayoutStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  alignItems: "flex-start",
  flexWrap: "wrap",
} satisfies CSSProperties;

const supportTextStyle = {
  margin: 0,
  color: "#475569",
} satisfies CSSProperties;

const errorTextStyle = {
  margin: 0,
  color: "#b00020",
} satisfies CSSProperties;
