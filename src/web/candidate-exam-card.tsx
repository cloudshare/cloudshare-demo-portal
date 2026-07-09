"use client";

import React, { type CSSProperties, useState } from "react";
import type { CandidateDashboardData } from "./candidate-scheduling";
import {
  buildCandidateExamDurationLabels,
  getAttemptPrimaryAction,
  getAttemptWaitingMessage,
  getCandidateCurrentAttemptLabel,
  getNextScheduleAvailableLabelForExam,
} from "./candidate-home-state";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import {
  publishedExamActionGroupStyle,
  publishedExamActionRowStyle,
  publishedExamDescriptionStyle,
  publishedExamDisclosureBodyStyle,
  publishedExamDisclosureSummaryStyle,
  publishedExamDurationPillsStyle,
  publishedExamHeaderStyle,
  publishedExamScheduleFieldStyle,
  publishedExamTitleBlockStyle,
  publishedExamTitleRowStyle,
} from "./candidate-home-layout";
import { alertPanelStyle, cardStyle } from "./card-styles";
import {
  disabledButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./button-styles";
import { statusBadgeStyle } from "./status-badge";

type ScheduleFeedback = {
  readonly kind: "error" | "warning";
  readonly message: string;
};

interface CandidateExamCardProps {
  readonly exam: CandidateDashboardData["exams"][number];
  readonly attempt: CandidateDashboardData["attempts"][number] | null;
  readonly attemptedSessionIds: ReadonlySet<string>;
  readonly nowMs: number;
  readonly allAttempts?: CandidateDashboardData["attempts"];
  readonly scheduleDraft: string;
  readonly scheduleFeedback: ScheduleFeedback | null;
  readonly submittingExamId: string | null;
  readonly submittingSessionId: string | null;
  readonly onScheduleDraftChange: (draft: string) => void;
  readonly onSchedule: () => void;
  readonly onCurrentAttemptAction: (
    attempt: CandidateDashboardData["attempts"][number],
    action: "Enter exam" | "Return to exam" | "Resume exam" | "View score",
  ) => void;
  readonly onStartCohortSession: (sessionId: string) => void;
}

export function PublishedExamCardHeader({
  title,
  description,
  runtimeLimit,
  openWindow,
}: {
  readonly title: string;
  readonly description: string;
  readonly runtimeLimit: string;
  readonly openWindow: string;
}) {
  return (
    <div style={publishedExamHeaderStyle}>
      <div style={publishedExamTitleRowStyle}>
        <div style={publishedExamTitleBlockStyle}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>{title}</h3>
        </div>
        <div style={publishedExamDurationPillsStyle}>
          <span style={statusBadgeStyle("info")}>{runtimeLimit}</span>
          <span style={statusBadgeStyle("info")}>{openWindow}</span>
        </div>
      </div>
      <p style={publishedExamDescriptionStyle}>
        {description || "No description provided."}
      </p>
    </div>
  );
}

export function CandidateCohortSessionOptions({
  sessions,
  attemptedSessionIds,
  currentAttemptStatus,
  submittingSessionId,
  onStart,
}: {
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly admissionStartsAt: string;
    readonly admissionEndsAt: string | null;
  }>;
  readonly attemptedSessionIds: ReadonlySet<string>;
  readonly currentAttemptStatus: CandidateDashboardData["attempts"][number]["status"] | null;
  readonly submittingSessionId: string | null;
  readonly onStart: (sessionId: string) => void;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <span style={{ color: "#475569", fontSize: "0.9rem", fontWeight: 600 }}>
        Start a shared cohort session
      </span>
      <div style={{ display: "grid", gap: "0.6rem" }}>
        {sessions.map((session) => {
          const attemptedThisSession = attemptedSessionIds.has(session.id);
          const joinDisabled =
            submittingSessionId === session.id ||
            (currentAttemptStatus !== null &&
              currentAttemptStatus !== "completed" &&
              currentAttemptStatus !== "expired") ||
            attemptedThisSession;
          return (
            <div
              key={session.id}
              style={{
                ...metaItemStyle,
                gridTemplateColumns: "minmax(0, 1fr) auto",
                alignItems: "center",
              }}
            >
              <div style={{ display: "grid", gap: "0.2rem", minWidth: 0 }}>
                <strong style={{ color: "#0f172a" }}>{session.name}</strong>
                <span style={metaHintStyle}>
                  Opened {formatCandidateScheduledDateTime(session.admissionStartsAt) ?? "Now"}
                  {session.admissionEndsAt
                    ? ` · Closes ${formatCandidateScheduledDateTime(session.admissionEndsAt) ?? "TBD"}`
                    : ""}
                </span>
              </div>
              <button
                onClick={() => onStart(session.id)}
                disabled={joinDisabled}
                style={getButtonStyle(primaryButtonStyle, joinDisabled)}
              >
                {submittingSessionId === session.id ? "Starting..." : "Start exam"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function getAvailableSessionsSummary({
  availableCohortSessionCount,
  individualSchedulingEnabled,
}: {
  readonly availableCohortSessionCount: number;
  readonly individualSchedulingEnabled: boolean;
}): string {
  if (availableCohortSessionCount > 0) {
    return `${availableCohortSessionCount} ready to start`;
  }

  if (individualSchedulingEnabled) {
    return "Individual scheduling available";
  }

  return "No sessions available right now";
}

export function getDefaultCandidateExamCardPanelState({
  exam,
  attempt,
  nowMs,
}: {
  readonly exam: CandidateDashboardData["exams"][number];
  readonly attempt: CandidateDashboardData["attempts"][number] | null;
  readonly nowMs: number;
}): { readonly browseOpen: boolean; readonly takeExamOpen: boolean } {
  const primaryAction = getAttemptPrimaryAction(attempt, nowMs, exam);
  const hasImmediateAttemptAction =
    primaryAction.label !== null &&
    primaryAction.label !== "View score" &&
    primaryAction.disabled === false;
  const hasAvailableCohortSession = (exam.availableCohortSessions?.length ?? 0) > 0;
  const takeExamOpen = hasImmediateAttemptAction || hasAvailableCohortSession;
  return {
    browseOpen: !takeExamOpen,
    takeExamOpen,
  };
}

export function CandidateExamCard({
  exam,
  attempt,
  attemptedSessionIds,
  nowMs,
  allAttempts = [],
  scheduleDraft,
  scheduleFeedback,
  submittingExamId,
  submittingSessionId,
  onScheduleDraftChange,
  onSchedule,
  onCurrentAttemptAction,
  onStartCohortSession,
}: CandidateExamCardProps) {
  const panelState = getDefaultCandidateExamCardPanelState({ exam, attempt, nowMs });
  const [browseOpen, setBrowseOpen] = useState(panelState.browseOpen);
  const [takeExamOpen, setTakeExamOpen] = useState(panelState.takeExamOpen);
  const availableCohortSessions = exam.availableCohortSessions ?? [];
  const individualSchedulingEnabled = exam.individualSchedulingEnabled !== false;
  const durationLabels = buildCandidateExamDurationLabels(exam);
  const primaryAction = getAttemptPrimaryAction(attempt, nowMs, exam);
  const waitingMessage = getAttemptWaitingMessage(attempt, nowMs, exam);
  const nextScheduleAvailableLabel = getNextScheduleAvailableLabelForExam(allAttempts, exam.id, exam);

  return (
    <article style={cardStyle}>
      <div style={{ display: "grid", gap: "1rem" }}>
        <PublishedExamCardHeader
          title={exam.title}
          description={exam.description}
          runtimeLimit={durationLabels.runtimeLimit}
          openWindow={durationLabels.openWindow}
        />

        <details
          open={browseOpen}
          onToggle={(event) => setBrowseOpen(event.currentTarget.open)}
          style={detailsStyle}
        >
          <summary style={publishedExamDisclosureSummaryStyle}>
            <span style={disclosureTitleStyle}>Browse</span>
            <span style={disclosureHintStyle}>
              Review exam details before choosing how to take it.
            </span>
          </summary>
          {browseOpen ? (
            <div style={publishedExamDisclosureBodyStyle}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                  gap: "0.75rem",
                }}
              >
                <div style={metaItemStyle}>
                  <span style={metaLabelStyle}>Runtime limit</span>
                  <span style={metaValueStyle}>{durationLabels.runtimeLimit}</span>
                </div>
                <div style={metaItemStyle}>
                  <span style={metaLabelStyle}>Open window</span>
                  <span style={metaValueStyle}>{durationLabels.openPeriodDetail}</span>
                </div>
                <div style={metaItemStyle}>
                  <span style={metaLabelStyle}>Guided Journey scoring</span>
                  <span style={metaValueStyle}>
                    {exam.scoreRetrievalEnabled ? "Enabled" : "Not enabled for this Exam"}
                  </span>
                </div>
                <div style={metaItemStyle}>
                  <span style={metaLabelStyle}>Current attempt</span>
                  <span style={{ ...metaValueStyle, display: "grid", gap: "0.15rem" }}>
                    {getCandidateCurrentAttemptLabel(attempt, nowMs, exam)}
                    {nextScheduleAvailableLabel ? (
                      <span style={metaHintStyle}>
                        Next schedule available {nextScheduleAvailableLabel}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </details>

        <details
          open={takeExamOpen}
          onToggle={(event) => setTakeExamOpen(event.currentTarget.open)}
          style={detailsStyle}
        >
          <summary style={publishedExamDisclosureSummaryStyle}>
            <span style={disclosureTitleStyle}>Take exam</span>
            <span style={disclosureHintStyle}>
              {getTakeExamAvailabilitySummary({
                availableCohortSessionCount: availableCohortSessions.length,
                individualSchedulingEnabled,
                primaryActionLabel: primaryAction.label,
                primaryActionDisabled: primaryAction.disabled,
              })}
            </span>
          </summary>
          {takeExamOpen ? (
            <div style={publishedExamDisclosureBodyStyle}>
              <div style={metaItemStyle}>
                <span style={metaLabelStyle}>Availability</span>
                <span style={metaValueStyle}>
                  {getTakeExamAvailabilitySummary({
                    availableCohortSessionCount: availableCohortSessions.length,
                    individualSchedulingEnabled,
                    primaryActionLabel: primaryAction.label,
                    primaryActionDisabled: primaryAction.disabled,
                  })}
                </span>
              </div>

              {primaryAction.label && attempt ? (
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => onCurrentAttemptAction(attempt, primaryAction.label as NonNullable<typeof primaryAction.label>)}
                    disabled={primaryAction.disabled}
                    style={getButtonStyle(primaryButtonStyle, primaryAction.disabled)}
                  >
                    {primaryAction.label}
                  </button>
                  {waitingMessage ? (
                    <span style={{ color: "#555", lineHeight: 1.4 }}>{waitingMessage}</span>
                  ) : null}
                </div>
              ) : null}

              <CandidateCohortSessionOptions
                sessions={availableCohortSessions}
                attemptedSessionIds={attemptedSessionIds}
                currentAttemptStatus={attempt?.status ?? null}
                submittingSessionId={submittingSessionId}
                onStart={onStartCohortSession}
              />

              {individualSchedulingEnabled ? (
                <div style={publishedExamActionRowStyle}>
                  <label style={publishedExamScheduleFieldStyle}>
                    <span style={{ color: "#475569", fontSize: "0.9rem", fontWeight: 600 }}>
                      Schedule date and time
                    </span>
                    <input
                      type="datetime-local"
                      value={scheduleDraft}
                      onChange={(event) => onScheduleDraftChange(event.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <div style={publishedExamActionGroupStyle}>
                    <button
                      onClick={onSchedule}
                      disabled={submittingExamId === exam.id}
                      style={getButtonStyle(primaryButtonStyle, submittingExamId === exam.id)}
                    >
                      {submittingExamId === exam.id ? "Scheduling..." : "Schedule exam"}
                    </button>
                  </div>
                </div>
              ) : null}

              {!individualSchedulingEnabled &&
              availableCohortSessions.length === 0 &&
              primaryAction.label === null ? (
                <p role="status" style={{ ...alertPanelStyle.warning, margin: 0 }}>
                  No ways to take this Exam right now.
                </p>
              ) : null}

              {scheduleFeedback ? (
                <p
                  role={scheduleFeedback.kind === "error" ? "alert" : "status"}
                  style={{
                    ...(scheduleFeedback.kind === "error"
                      ? alertPanelStyle.danger
                      : alertPanelStyle.warning),
                    margin: 0,
                  }}
                >
                  {scheduleFeedback.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </details>
      </div>
    </article>
  );
}

function getTakeExamAvailabilitySummary(input: {
  readonly availableCohortSessionCount: number;
  readonly individualSchedulingEnabled: boolean;
  readonly primaryActionLabel: "Enter exam" | "Return to exam" | "Resume exam" | "View score" | null;
  readonly primaryActionDisabled: boolean;
}): string {
  if (!input.primaryActionDisabled) {
    if (input.primaryActionLabel === "Enter exam") {
      return "Current attempt ready to enter";
    }
    if (input.primaryActionLabel === "Resume exam") {
      return "Current attempt ready to resume";
    }
    if (input.primaryActionLabel === "Return to exam") {
      return "Current attempt in progress";
    }
  }

  if (input.availableCohortSessionCount > 0) {
    return input.availableCohortSessionCount === 1
      ? "1 session ready to start"
      : `${input.availableCohortSessionCount} sessions ready to start`;
  }

  if (input.individualSchedulingEnabled) {
    return "Schedule an individual start time";
  }

  return "No ways to take this Exam right now.";
}

function getButtonStyle(baseStyle: CSSProperties, disabled: boolean): CSSProperties {
  return disabled
    ? {
        ...baseStyle,
        ...disabledButtonStyle,
      }
    : baseStyle;
}

const detailsStyle: CSSProperties = {
  borderTop: "1px solid #e2e8f0",
  paddingTop: "1rem",
};

const disclosureTitleStyle: CSSProperties = {
  color: "#0f172a",
  fontSize: "1rem",
  fontWeight: 700,
};

const disclosureHintStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.9rem",
  lineHeight: 1.4,
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
