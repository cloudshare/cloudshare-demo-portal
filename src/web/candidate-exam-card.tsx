"use client";

import React, { type CSSProperties, useState } from "react";
import type { CandidateDashboardData } from "./candidate-scheduling";
import {
  buildCandidateExamDurationLabels,
} from "./candidate-home-state";
import { formatCandidateScheduledDateTime } from "./candidate-date-format";
import {
  publishedExamActionGroupStyle,
  publishedExamDescriptionStyle,
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
} from "./button-styles";
import { statusBadgeStyle } from "./status-badge";

type CandidateAttempt = CandidateDashboardData["attempts"][number];
type CandidateExam = CandidateDashboardData["exams"][number];
type ScheduleFeedback = {
  readonly kind: "error" | "warning";
  readonly message: string;
};

interface CandidateExamCardProps {
  readonly exam: CandidateExam;
  readonly attemptedSessionIds: ReadonlySet<string>;
  readonly scheduleDraft: string;
  readonly scheduleFeedback: ScheduleFeedback | null;
  readonly submittingExamId: string | null;
  readonly submittingSessionId: string | null;
  readonly onScheduleDraftChange: (draft: string) => void;
  readonly onSchedule: () => void;
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
      {description ? <p style={publishedExamDescriptionStyle}>{description}</p> : null}
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
  readonly currentAttemptStatus: CandidateAttempt["status"] | null;
  readonly submittingSessionId: string | null;
  readonly onStart: (sessionId: string) => void;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "0.65rem" }}>
      <span style={actionGroupTitleStyle}>Available now</span>
      <div style={{ display: "grid", gap: "0.55rem" }}>
        {sessions.map((session, index) => {
          const attemptedThisSession = attemptedSessionIds.has(session.id);
          const joinDisabled =
            submittingSessionId === session.id ||
            (currentAttemptStatus !== null &&
              currentAttemptStatus !== "completed" &&
              currentAttemptStatus !== "expired") ||
            attemptedThisSession;
          const windowLabel = getImmediateStartWindowLabel(session);

          return (
            <div
              key={session.id}
              style={immediateStartOptionStyle}
            >
              <div style={{ display: "grid", gap: "0.15rem", minWidth: 0 }}>
                <strong style={{ color: "#0f172a" }}>
                  {sessions.length === 1 ? "Ready to start" : `Ready option ${index + 1}`}
                </strong>
                <span style={metaHintStyle}>{windowLabel}</span>
              </div>
              <button
                onClick={() => onStart(session.id)}
                disabled={joinDisabled}
                style={getButtonStyle(cardPrimaryButtonStyle, joinDisabled)}
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

export function getCandidateExamCardImmediateActionReason({
  exam,
}: {
  readonly exam: CandidateExam;
}): string | null {
  if ((exam.availableCohortSessions?.length ?? 0) > 0) {
    return `available-now:${exam.id}:${exam.availableCohortSessions?.map((session) => session.id).join(",")}`;
  }

  return null;
}

export function CandidateExamCard({
  exam,
  attemptedSessionIds,
  scheduleDraft,
  scheduleFeedback,
  submittingExamId,
  submittingSessionId,
  onScheduleDraftChange,
  onSchedule,
  onStartCohortSession,
}: CandidateExamCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const availableCohortSessions = exam.availableCohortSessions ?? [];
  const individualSchedulingEnabled = exam.individualSchedulingEnabled !== false;
  const durationLabels = buildCandidateExamDurationLabels(exam);
  const availabilitySummary = getTakeExamAvailabilitySummary({
    availableCohortSessionCount: availableCohortSessions.length,
    individualSchedulingEnabled,
    primaryActionLabel: null,
    primaryActionDisabled: true,
  });

  return (
    <article
      style={{
        ...examCardShellStyle,
        ...(isHovered ? examCardShellHoverStyle : null),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={flipPerspectiveStyle}>
        <div style={getFlipInnerStyle(showDetails)}>
          <section
            aria-hidden={showDetails}
            style={{
              ...flipFaceStyle,
              ...(showDetails ? hiddenFaceStyle : null),
            }}
          >
            <div style={frontCardContentStyle}>
              <div style={cardTopAccentStyle} />
              <PublishedExamCardHeader
                title={exam.title}
                description=""
                runtimeLimit={durationLabels.runtimeLimit}
                openWindow={durationLabels.openWindow}
              />

              <div style={availabilityBandStyle}>
                <span style={availabilityLabelStyle}>How you can take it</span>
                <strong style={availabilityValueStyle}>{availabilitySummary}</strong>
              </div>

              <div style={frontActionAreaStyle}>
                <CandidateCohortSessionOptions
                  sessions={availableCohortSessions}
                  attemptedSessionIds={attemptedSessionIds}
                  currentAttemptStatus={null}
                  submittingSessionId={submittingSessionId}
                  onStart={onStartCohortSession}
                />

                {individualSchedulingEnabled ? (
                  <div style={scheduleActionStackStyle}>
                    <label style={catalogueScheduleFieldStyle}>
                      <span style={actionGroupTitleStyle}>Schedule date and time</span>
                      <input
                        type="datetime-local"
                        value={scheduleDraft}
                        onChange={(event) => onScheduleDraftChange(event.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <div style={catalogueActionGroupStyle}>
                      <button
                        onClick={onSchedule}
                        disabled={submittingExamId === exam.id}
                        style={getButtonStyle(cardPrimaryButtonStyle, submittingExamId === exam.id)}
                      >
                        {submittingExamId === exam.id ? "Scheduling..." : "Schedule exam"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {!individualSchedulingEnabled && availableCohortSessions.length === 0 ? (
                  <p role="status" style={{ ...alertPanelStyle.warning, margin: 0 }}>
                    This Exam is not available right now.
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

              <div style={cardFooterStyle}>
                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  style={cardSecondaryButtonStyle}
                >
                  Exam details
                </button>
              </div>
            </div>
          </section>

          <section
            aria-hidden={!showDetails}
            style={{
              ...flipFaceStyle,
              ...flipBackFaceStyle,
              ...(!showDetails ? hiddenFaceStyle : null),
            }}
          >
            <div style={backCardContentStyle}>
              <div style={cardTopAccentStyle} />
              <div style={backDetailsBodyStyle}>
                <div style={{ display: "grid", gap: "0.45rem" }}>
                  <span style={detailsEyebrowStyle}>Exam details</span>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>{exam.title}</h3>
                  <p style={publishedExamDescriptionStyle}>
                    {exam.description || "No description provided."}
                  </p>
                </div>

                <div style={detailsGridStyle}>
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
                    <span style={metaLabelStyle}>Availability</span>
                    <span style={metaValueStyle}>{availabilitySummary}</span>
                  </div>
                </div>
              </div>

              <div style={cardFooterStyle}>
                <button
                  type="button"
                  onClick={() => setShowDetails(false)}
                  style={cardSecondaryButtonStyle}
                >
                  Back to exam
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

export function getTakeExamAvailabilitySummary(input: {
  readonly availableCohortSessionCount: number;
  readonly individualSchedulingEnabled: boolean;
  readonly primaryActionLabel: "Enter exam" | "Return to exam" | "Resume exam" | "View score" | null;
  readonly primaryActionDisabled: boolean;
}): string {
  if (!input.primaryActionDisabled) {
    if (input.primaryActionLabel === "Enter exam") {
      return "Ready to start now";
    }
    if (input.primaryActionLabel === "Resume exam") {
      return "Ready to resume";
    }
    if (input.primaryActionLabel === "Return to exam") {
      return "In progress";
    }
    if (input.primaryActionLabel === "View score") {
      return "Score available";
    }
  }

  if (input.availableCohortSessionCount > 0) {
    return input.availableCohortSessionCount === 1
      ? "Ready to start now"
      : `${input.availableCohortSessionCount} start times available now`;
  }

  if (input.individualSchedulingEnabled) {
    return "Schedule a start time";
  }

  return "Not available right now";
}

function getImmediateStartWindowLabel(session: {
  readonly admissionStartsAt: string;
  readonly admissionEndsAt: string | null;
}): string {
  const openedAt = formatCandidateScheduledDateTime(session.admissionStartsAt);
  const closesAt = session.admissionEndsAt
    ? formatCandidateScheduledDateTime(session.admissionEndsAt)
    : null;

  if (closesAt) {
    return `Available until ${closesAt}`;
  }
  if (openedAt) {
    return `Available since ${openedAt}`;
  }
  return "Available now";
}

function getButtonStyle(baseStyle: CSSProperties, disabled: boolean): CSSProperties {
  return disabled
    ? {
        ...baseStyle,
        ...disabledButtonStyle,
      }
    : baseStyle;
}

function getFlipInnerStyle(showDetails: boolean): CSSProperties {
  return {
    display: "grid",
    position: "relative",
    height: "100%",
    minHeight: "29rem",
    transformStyle: "preserve-3d",
    transform: showDetails ? "rotateY(180deg)" : "rotateY(0deg)",
    transition: "transform 260ms ease",
  };
}

const examCardShellStyle: CSSProperties = {
  ...cardStyle,
  padding: 0,
  minHeight: "29rem",
  height: "29rem",
  border: "1px solid #dbe4ef",
  overflow: "hidden",
  background: "#ffffff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  transition: "border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease",
};

const examCardShellHoverStyle: CSSProperties = {
  border: "1px solid #4f46e5",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.14)",
  transform: "translateY(-2px)",
};

const flipPerspectiveStyle: CSSProperties = {
  perspective: "1200px",
  height: "100%",
  minHeight: "29rem",
};

const flipFaceStyle: CSSProperties = {
  gridArea: "1 / 1",
  position: "absolute",
  inset: 0,
  backfaceVisibility: "hidden",
  WebkitBackfaceVisibility: "hidden",
  minWidth: 0,
};

const flipBackFaceStyle: CSSProperties = {
  transform: "rotateY(180deg)",
};

const hiddenFaceStyle: CSSProperties = {
  pointerEvents: "none",
};

const frontCardContentStyle: CSSProperties = {
  display: "grid",
  gap: "1rem",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto",
  alignContent: "stretch",
  height: "100%",
  padding: "1.05rem",
  boxSizing: "border-box",
};

const backCardContentStyle: CSSProperties = {
  ...frontCardContentStyle,
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  overflow: "hidden",
};

const backDetailsBodyStyle: CSSProperties = {
  display: "grid",
  gap: "1rem",
  minHeight: 0,
  overflow: "auto",
  paddingRight: "0.2rem",
};

const cardTopAccentStyle: CSSProperties = {
  height: "3px",
  borderRadius: "999px",
  background: "linear-gradient(90deg, #4f46e5 0%, #10b981 55%, #f97316 100%)",
};

const availabilityBandStyle: CSSProperties = {
  display: "grid",
  gap: "0.2rem",
  padding: "0.8rem",
  border: "1px solid #dbeafe",
  borderRadius: "8px",
  background: "#eff6ff",
};

const frontActionAreaStyle: CSSProperties = {
  display: "grid",
  gap: "0.85rem",
  alignContent: "end",
  minHeight: 0,
};

const immediateStartOptionStyle: CSSProperties = {
  display: "grid",
  gap: "0.65rem",
  alignItems: "end",
};

const scheduleActionStackStyle: CSSProperties = {
  display: "grid",
  gap: "0.75rem",
};

const catalogueScheduleFieldStyle: CSSProperties = {
  ...publishedExamScheduleFieldStyle,
  maxWidth: "none",
  flex: "initial",
};

const catalogueActionGroupStyle: CSSProperties = {
  ...publishedExamActionGroupStyle,
  justifyContent: "stretch",
  marginLeft: 0,
};

const cardPrimaryButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  width: "100%",
  minHeight: "3.1rem",
};

const cardSecondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.4rem",
  padding: "0.65rem 1.1rem",
  borderRadius: "6px",
  fontWeight: 600,
  fontSize: "0.95rem",
  lineHeight: 1.2,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  width: "100%",
  minHeight: "3.1rem",
};

const availabilityLabelStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.78rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const availabilityValueStyle: CSSProperties = {
  color: "#0f172a",
  fontSize: "1rem",
};

const actionGroupTitleStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.9rem",
  fontWeight: 600,
};

const detailsEyebrowStyle: CSSProperties = {
  color: "#4338ca",
  fontSize: "0.78rem",
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: "uppercase",
};

const detailsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
  gap: "0.65rem",
};

const metaItemStyle: CSSProperties = {
  display: "grid",
  gap: "0.3rem",
  padding: "0.75rem",
  border: "1px solid #e2e8f0",
  borderRadius: "6px",
  background: "#f8fafc",
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

const cardFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: "0.75rem",
  marginTop: "auto",
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
