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
import {
  accountLogoutButtonStyle,
  disabledButtonStyle,
  secondaryButtonStyle,
} from "@/web/button-styles";
import { eyebrowLabelStyle } from "@/web/design-tokens";
import { statusBadgeStyle } from "@/web/status-badge";
import { PortalPageHeader } from "@/web/portal-page-header";

interface ScoreDisplayProps {
  readonly examAttemptId: string;
  readonly email: string;
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
export function ScoreDisplay({ examAttemptId, email }: ScoreDisplayProps) {
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

  const header = (
    <ScorePageHeader
      email={email}
      logoutPresentation={logoutPresentation}
      onBackToCandidateHome={() => router.push("/candidate")}
      onLogout={() => void logout()}
    />
  );

  if (fetchState === "error") {
    return (
      <>
        {header}
        <ScoreErrorPanel errorMessage={errorMessage} />
      </>
    );
  }

  if (fetchState === "loading") {
    return (
      <>
        {header}
        <p style={{ margin: 0 }}>Loading score...</p>
      </>
    );
  }

  if (!score) return null;

  const presentation = getCandidateScorePresentation({
    examAttemptId: score.examAttemptId,
    examTitle: score.examTitle,
    scheduledFor: score.scheduledFor,
  });

  return (
    <>
      {header}
      <ScoreLoadedPanel
        score={score}
        presentation={presentation}
      />
    </>
  );
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ScoreLoadedPanel({
  score,
  presentation = getCandidateScorePresentation({
    examAttemptId: score.examAttemptId,
    examTitle: score.examTitle,
    scheduledFor: score.scheduledFor,
  }),
}: {
  readonly score: ScorePayload;
  readonly presentation?: ReturnType<typeof getCandidateScorePresentation>;
}) {
  return (
    <section style={scorePanelStackStyle}>
      <section style={cardStyle}>
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
      </section>

      {score.scoreAvailable ? (
        <>
          <section style={resultSummaryStyle}>
            <div style={{ display: "grid", gap: "0.4rem" }}>
              <p style={eyebrowLabelStyle}>Result summary</p>
              <h3 style={{ margin: 0, fontSize: "2rem", lineHeight: 1.1 }}>
                {formatRate(score.passedRate)} pass rate
              </h3>
            </div>
            <div
              aria-label="Score summary details"
              style={compactSummaryGridStyle}
            >
              <SummaryStat label="Completion evidence" value={`${score.percentComplete}% complete`} />
              <SummaryStat label="Steps explored/complete" value={`${score.stepsCompleted} of ${score.stepsTotal}`} />
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
              aria-label="Metric breakdown"
              style={compactMetricGridStyle}
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
                aria-label="Step progress rows"
                style={stepProgressListStyle}
              >
                {score.steps.map((step) => (
                  <li key={step.stepId} style={stepProgressItemStyle}>
                    <div style={stepProgressRowStyle}>
                      <strong style={stepTitleStyle}>{step.title}</strong>
                      <span style={stepCompletionStyle}>
                        {step.completed ? "Completed" : "Not completed"}
                      </span>
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

export function ScoreErrorPanel({ errorMessage }: { readonly errorMessage: string }) {
  return (
    <section style={cardStyle}>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <p style={eyebrowLabelStyle}>Completion summary</p>
        <h2 style={{ margin: 0 }}>Score unavailable</h2>
        <p role="alert" style={errorTextStyle}>
          Could not load score: {errorMessage}
        </p>
      </div>
    </section>
  );
}

function ScorePageHeader({
  email,
  logoutPresentation,
  onBackToCandidateHome,
  onLogout,
}: ScorePanelActionProps & { readonly email: string }) {
  return (
    <PortalPageHeader
      eyebrow="Candidate score"
      title="Session complete"
      description="Review your final Guided Journey result and any CloudShare scoring limitations for this ExamAttempt."
      email={email}
      actions={
        <ScorePanelActions
          logoutPresentation={logoutPresentation}
          onBackToCandidateHome={onBackToCandidateHome}
          onLogout={onLogout}
        />
      }
    />
  );
}

function ScorePanelActions({
  logoutPresentation,
  onBackToCandidateHome,
  onLogout,
}: ScorePanelActionProps) {
  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <button type="button" onClick={onBackToCandidateHome} style={secondaryButtonStyle}>
        Back to Candidate Home
      </button>
      <button
        type="button"
        onClick={() => void onLogout()}
        disabled={logoutPresentation.disabled}
        style={getLogoutButtonStyle(logoutPresentation.disabled)}
      >
        {logoutPresentation.buttonLabel}
      </button>
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
    </div>
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

function SummaryStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={summaryStatRowStyle}>
      <span style={summaryStatLabelStyle}>{label}</span>
      <strong style={summaryStatValueStyle}>{value}</strong>
    </div>
  );
}

function formatRetrievedAt(retrievedAt: string): string {
  return formatCandidateScheduledDateTime(retrievedAt) ?? "Unavailable";
}

const scorePanelStackStyle = {
  display: "grid",
  gap: "1rem",
} satisfies CSSProperties;

const resultSummaryStyle = {
  ...mutedPanelStyle,
  display: "grid",
  gap: "0.85rem",
} satisfies CSSProperties;

const compactSummaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "0.5rem",
} satisfies CSSProperties;

const compactMetricGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "0.5rem",
} satisfies CSSProperties;

const summaryStatRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto",
  alignItems: "center",
  gap: "0.75rem",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  background: "#ffffff",
  padding: "0.7rem 0.85rem",
} satisfies CSSProperties;

const summaryStatLabelStyle = {
  color: "#475569",
  fontSize: "0.9rem",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} satisfies CSSProperties;

const summaryStatValueStyle = {
  color: "#0f172a",
  fontSize: "1rem",
  lineHeight: 1.2,
  textAlign: "right",
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const stepProgressListStyle = {
  display: "grid",
  gap: "0.5rem",
  margin: 0,
  paddingLeft: "1.25rem",
} satisfies CSSProperties;

const stepProgressItemStyle = {
  paddingLeft: "0.25rem",
} satisfies CSSProperties;

const stepProgressRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) auto auto",
  alignItems: "center",
  gap: "0.75rem",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  background: "#ffffff",
  padding: "0.7rem 0.85rem",
} satisfies CSSProperties;

const stepTitleStyle = {
  minWidth: 0,
} satisfies CSSProperties;

const stepCompletionStyle = {
  color: "#475569",
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const supportTextStyle = {
  margin: 0,
  color: "#475569",
} satisfies CSSProperties;

const errorTextStyle = {
  margin: 0,
  color: "#b00020",
} satisfies CSSProperties;
