"use client";

import React, { useEffect, useRef, useState } from "react";
import type {
  CohortExamSessionGuidedJourneyAggregateView,
  CohortExamSessionMonitoringView,
} from "@/api/admin-cohort-exam-session-detail";
import type { AdminNavigationIntent, DiagnosticLogFilters } from "./admin-shell-route";
import {
  createCorrelationDiagnosticsNavigationIntent,
  createSupportDiagnosticsNavigationIntent,
} from "./admin-shell-route";
import { isCohortSessionAuthoringAvailable, type ExamRecord } from "./admin-exam-catalog-authoring";
import { formatAdminAttemptStatus, formatAdminUtcTimestamp } from "./admin-attempt-presentation";
import { alertPanelStyle, cardStyle, mutedPanelStyle } from "./card-styles";
import { compactButtonStyle, primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { colors } from "./design-tokens";
import { statusBadgeStyle, type StatusTone } from "./status-badge";

export interface CohortExamSessionRecord {
  session: {
    id: string;
    name: string;
    admissionStartsAt: string;
    admissionEndsAt: string | null;
    capacity: number | null;
    status: "draft" | "publishing" | "published" | "closed" | "retired" | "publish_reconciliation_required";
    cloudShareTrainingId?: string | null;
    cloudShareExperienceId?: string | null;
    cloudShareTeamId?: string | null;
    publishedAt?: string | null;
    admissionClosedAt?: string | null;
    retiredAt?: string | null;
    lastPublishError?: string | null;
    lastPublishCorrelationId?: string | null;
  };
  inheritedContext: {
    project: { id: string; name: string };
    blueprint: { id: string; name: string };
    snapshot: { id: string; name: string };
    policy: { id: string; name: string };
    allowedRegions: Array<{ id: string; name: string }>;
    instructor: { id: string; name: string };
    scoreRetrievalEnabled: boolean;
    timeLimitMinutes: number;
  };
}

export interface CohortExamSessionFormState {
  name: string;
  admissionStartsAt: string;
  admissionEndsAt: string;
  capacity: string;
}

export function formatExamDeliveryAvailability(value: ExamRecord["deliveryAvailability"]): string {
  if (value === "cohort") return "Cohort Exam";
  if (value === "both") return "Individual + Cohort Exam";
  return "Individual Exam";
}

function formatRateSummary(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function CorrelationDiagnosticsLink(props: {
  readonly correlationId: string;
  readonly getNavigationHref?: (intent: AdminNavigationIntent) => string;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
  readonly children?: React.ReactNode;
}) {
  const navigation = createCorrelationDiagnosticsNavigationIntent(props.correlationId);

  return (
    <a
      href={props.getNavigationHref?.(navigation)}
      onClick={(event) => {
        if (!props.onNavigate) return;
        event.preventDefault();
        props.onNavigate(navigation);
      }}
      style={{ color: colors.info, fontFamily: "monospace", fontWeight: 700, overflowWrap: "anywhere" }}
    >
      {props.children ?? props.correlationId}
    </a>
  );
}

export const COHORT_SESSION_DRAFT_ONLY_COPY =
  "Published Cohort Exam Sessions admit Candidates until admission closes or the session is retired.";

function formatCohortSessionStatus(status: CohortExamSessionRecord["session"]["status"]): string {
  switch (status) {
    case "closed":
      return "Admission closed";
    case "publish_reconciliation_required":
      return "Publish reconciliation required";
    case "publishing":
      return "Publishing";
    case "published":
      return "Published";
    case "retired":
      return "Retired";
    case "draft":
    default:
      return "Draft";
  }
}

function getCohortSessionStatusTone(
  status: CohortExamSessionRecord["session"]["status"],
): StatusTone {
  switch (status) {
    case "published":
      return "positive";
    case "closed":
      return "warning";
    case "publishing":
      return "info";
    case "retired":
      return "neutral";
    case "publish_reconciliation_required":
      return "warning";
    case "draft":
    default:
      return "neutral";
  }
}

export function formatCohortSessionDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
}

const cohortSessionTileGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 20rem))",
  justifyContent: "start",
  alignItems: "start",
};

const cohortSessionTileStyle: React.CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: "0.75rem",
  padding: "0.9rem",
};

const cohortSessionMetaGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.6rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
  alignItems: "start",
};

const cohortSessionDetailGridStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
  alignItems: "start",
};

const cohortSessionDetailItemStyle: React.CSSProperties = {
  display: "grid",
  gap: "0.2rem",
  padding: "0.7rem 0.8rem",
  borderRadius: "6px",
  background: colors.surfaceSubtle,
  minWidth: 0,
};

const cohortSessionDetailLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: colors.textSecondary,
};

const problemReasonListStyle: React.CSSProperties = {
  margin: "0.45rem 0 0",
  paddingLeft: "1rem",
  color: colors.textPrimary,
};

const reconciliationWarningRowStyle: React.CSSProperties = {
  borderBottom: `1px solid ${colors.border}`,
  background: colors.warningSoft,
};

function formatProblemRowCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function CohortSessionDetailItem(props: {
  label: string;
  value: React.ReactNode;
  help?: string;
}) {
  return (
    <div style={cohortSessionDetailItemStyle} title={props.help}>
      <div style={cohortSessionDetailLabelStyle}>{props.label}</div>
      <div style={{ overflowWrap: "anywhere" }}>{props.value}</div>
    </div>
  );
}

type CohortMonitoringSummaryFilter = "active" | "in_progress" | "completed" | "problems" | "state_observations" | "portal_attempts" | "cloudshare_participants";

const cohortMonitoringSummaryFilterLabel: Record<CohortMonitoringSummaryFilter, string> = {
  active: "Active",
  in_progress: "In progress",
  completed: "Completed",
  problems: "Needs attention",
  state_observations: "State observations",
  portal_attempts: "Session exam attempts",
  cloudshare_participants: "CloudShare participants",
};

function CohortSessionMonitoringSummaryItem(props: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly help: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly tone?: "informational";
}) {
  return (
    <button
      type="button"
      title={props.help}
      aria-pressed={props.selected}
      onClick={props.onSelect}
      style={{
        ...cohortSessionDetailItemStyle,
        background: props.tone === "informational" ? colors.infoSoft : undefined,
        border: props.selected ? `2px solid ${props.tone === "informational" ? colors.info : colors.accent}` : "1px solid transparent",
        textAlign: "left",
        cursor: "pointer",
        color: colors.textPrimary,
      }}
    >
      <span style={cohortSessionDetailLabelStyle}>{props.label}</span>
      <span style={{ overflowWrap: "anywhere" }}>{props.value}</span>
    </button>
  );
}

function isCohortMonitoringProblem(row: { readonly reconciliation?: "normal" | "unknown" | "state_observation" | "needs_attention"; readonly problemReasons: readonly string[] }): boolean {
  return (row.reconciliation ?? (row.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention";
}

function isCohortMonitoringStateObservation(row: { readonly reconciliation?: "normal" | "unknown" | "state_observation" | "needs_attention"; readonly problemReasons: readonly string[] }): boolean {
  return (row.reconciliation ?? (row.problemReasons.length > 0 ? "needs_attention" : "normal")) === "state_observation";
}

function ProblemReasonList(props: { readonly reasons: readonly string[] }) {
  if (props.reasons.length === 0) {
    return null;
  }

  return (
    <ul style={problemReasonListStyle}>
      {props.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}

function CohortSessionAttentionSummary(props: {
  readonly problemCount: number;
  readonly portalProblemRows: number;
  readonly cloudShareProblemRows: number;
  readonly cloudShareReadUnavailable: boolean;
  readonly cloudShareReadRateLimited: boolean;
}) {
  const totalProblemRows = props.portalProblemRows + props.cloudShareProblemRows;

  if (props.problemCount === 0 && totalProblemRows === 0 && !props.cloudShareReadUnavailable) {
    return (
      <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
        {props.cloudShareReadRateLimited
          ? "CloudShare is cooling down the participant roster refresh. This does not create a reconciliation problem; the next refresh will compare the roster again."
          : "No items currently need attention. Environment and portal runtime state agree."}
      </div>
    );
  }

  return (
    <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.35rem" }}>
      <strong>Needs attention: {props.problemCount}</strong>
      <span>
        Rows below with actionable state conflicts: {totalProblemRows} total (
        {formatProblemRowCount(props.portalProblemRows, "session exam attempt row", "session exam attempt rows")},{" "}
        {formatProblemRowCount(props.cloudShareProblemRows, "CloudShare participant row", "CloudShare participant rows")}
        ).
      </span>
      <span>
        Each item states the conflicting state and points to the relevant evidence. Matched portal/CloudShare rows can
        appear in both tables because they describe the same correlation from different sides.
      </span>
      {props.cloudShareReadUnavailable ? (
        <span>The unavailable CloudShare participant read below needs attention because current environment state cannot be established.</span>
      ) : null}
    </div>
  );
}

function getCloudShareIdentifierFields(session: {
  cloudShareTrainingId?: string | null;
  cloudShareExperienceId?: string | null;
}): Array<{ label: string; value: string }> {
  const trainingId = session.cloudShareTrainingId?.trim() ?? "";
  const experienceId = session.cloudShareExperienceId?.trim() ?? "";

  if (trainingId && experienceId && trainingId === experienceId) {
    return [{ label: "CloudShare Experience ID", value: experienceId }];
  }

  const fields: Array<{ label: string; value: string }> = [];

  if (trainingId) {
    fields.push({ label: "CloudShare training ID", value: trainingId });
  }

  if (experienceId) {
    fields.push({ label: "CloudShare Experience ID", value: experienceId });
  }

  return fields;
}

export function normalizeAdminLocalDateTime(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function CohortSessionDraftControls(props: {
  examId: string;


  form: CohortExamSessionFormState;
  sessions: CohortExamSessionRecord[];
  loading: boolean;
  onChange: (patch: Partial<CohortExamSessionFormState>) => void;
  onCreate: () => void;
  onSelect: (session: CohortExamSessionRecord) => void;
}) {
  const fieldStyle = { padding: "0.45rem", border: "1px solid #ccc", borderRadius: "6px" };
  const activeSessions = props.sessions.filter((session) => session.session.status !== "retired");
  const retiredSessions = props.sessions.filter((session) => session.session.status === "retired");
  return (
    <div style={{ display: "grid", gap: "0.45rem" }}>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Session name</span>
        <input
          value={props.form.name}
          onChange={(event) => props.onChange({ name: event.target.value })}
          style={fieldStyle}
        />
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Admission opens</span>
        <input
          type="datetime-local"
          value={props.form.admissionStartsAt}
          onChange={(event) => props.onChange({ admissionStartsAt: event.target.value })}
          style={fieldStyle}
        />
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Optional admission closes</span>
        <input
          type="datetime-local"
          value={props.form.admissionEndsAt}
          onChange={(event) => props.onChange({ admissionEndsAt: event.target.value })}
          style={fieldStyle}
        />
      </label>
      <label style={{ display: "grid", gap: "0.25rem" }}>
        <span>Optional capacity</span>
        <input
          type="number"
          min={1}
          value={props.form.capacity}
          onChange={(event) => props.onChange({ capacity: event.target.value })}
          style={fieldStyle}
        />
      </label>
      <button onClick={props.onCreate} disabled={props.loading} style={primaryButtonStyle}>
        Create Draft Cohort Session
      </button>
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <strong>Existing Cohort Sessions</strong>
        {activeSessions.length === 0 ? (
          <span style={{ color: "#666" }}>No draft Cohort Exam Sessions yet.</span>
        ) : (
          <div style={cohortSessionTileGridStyle}>
            {activeSessions.map((session) => (
              <div key={`${props.examId}-${session.session.id}`} style={cohortSessionTileStyle}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 600 }}>{session.session.name}</div>
                  <span style={statusBadgeStyle(getCohortSessionStatusTone(session.session.status))}>
                    {formatCohortSessionStatus(session.session.status)}
                  </span>
                </div>
                <div style={cohortSessionMetaGridStyle}>
                  <CohortSessionDetailItem
                    label="Admission opens"
                    value={formatCohortSessionDateTime(session.session.admissionStartsAt)}
                  />
                  <CohortSessionDetailItem
                    label="Admission closes"
                    value={formatCohortSessionDateTime(session.session.admissionEndsAt)}
                  />
                  <CohortSessionDetailItem
                    label="Capacity"
                    value={session.session.capacity === null ? "Unlimited" : session.session.capacity}
                  />
                  {getCloudShareIdentifierFields(session.session).map((field) => (
                    <CohortSessionDetailItem key={field.label} label={field.label} value={field.value} />
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => props.onSelect(session)} style={compactButtonStyle}>
                    View session details
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {retiredSessions.length > 0 ? (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <strong>Retired session history</strong>
          <div style={cohortSessionTileGridStyle}>
            {retiredSessions.map((session) => (
              <div key={`${props.examId}-${session.session.id}`} style={cohortSessionTileStyle}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 600 }}>{session.session.name}</div>
                  <span style={statusBadgeStyle(getCohortSessionStatusTone(session.session.status))}>
                    {formatCohortSessionStatus(session.session.status)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => props.onSelect(session)} style={compactButtonStyle}>
                    Open history
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CohortSessionAuthoringPanel(props: {
  examId: string;
  deliveryAvailability: ExamRecord["deliveryAvailability"];
  form: CohortExamSessionFormState;
  sessions: CohortExamSessionRecord[];
  loading: boolean;
  onChange: (patch: Partial<CohortExamSessionFormState>) => void;
  onCreate: () => void;
  onSelect: (session: CohortExamSessionRecord) => void;
}) {
  return (
    <div style={{ marginTop: "0.8rem", display: "grid", gap: "0.5rem", minWidth: "16rem" }}>
      <strong>Draft Cohort Exam Sessions</strong>
      {isCohortSessionAuthoringAvailable(props.deliveryAvailability) ? (
        <CohortSessionDraftControls
          examId={props.examId}
          form={props.form}
          sessions={props.sessions}
          loading={props.loading}
          onChange={props.onChange}
          onCreate={props.onCreate}
          onSelect={props.onSelect}
        />
      ) : (
        <span style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
          Cohort Exam Sessions are unavailable for individual-only Exams.
        </span>
      )}
    </div>
  );
}

export function CohortSessionDraftOnlyNotice() {
  return (
    <p style={{ margin: 0, color: colors.textSecondary, fontSize: "0.9rem" }}>
      {COHORT_SESSION_DRAFT_ONLY_COPY}
    </p>
  );
}

export function CohortSessionWorkspacePanel(props: {
  examTitle: string;
  session: CohortExamSessionRecord;
  detail?: CohortExamSessionMonitoringView | null;
  mode?: "catalog" | "monitoring";
  loading: boolean;
  onBack: () => void;
  onPublish: () => void;
  onCloseAdmission?: () => void;
  onRetire?: () => void;
  onOpenMonitoring?: () => void;
  getNavigationHref?: (intent: AdminNavigationIntent) => string;
  onNavigate?: (intent: AdminNavigationIntent) => void;
  lastCheckedAt?: string | null;
  onRefresh?: () => void;
}) {
  const { session } = props;
  const isMonitoring = props.mode === "monitoring";
  const [timeline, setTimeline] = useState<{ title: string; events: readonly string[]; diagnostics: DiagnosticLogFilters } | null>(null);
  const [summaryFilter, setSummaryFilter] = useState<CohortMonitoringSummaryFilter | null>(null);
  const timelineRef = useRef<HTMLElement>(null);
  useEffect(() => { if (timeline) timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [timeline]);
  const portalProblemRows =
    props.detail?.portalAttempts.filter((attempt) => (attempt.reconciliation ?? (attempt.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention").length ?? 0;
  const cloudShareProblemRows =
    props.detail?.cloudShareParticipants.participants.filter((participant) => (participant.reconciliation ?? (participant.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention")
      .length ?? 0;
  const portalAttempts = props.detail?.portalAttempts ?? [];
  const cloudShareParticipants = props.detail?.cloudShareParticipants.participants ?? [];
  const visiblePortalAttempts = portalAttempts.filter((attempt) => {
    if (!summaryFilter || summaryFilter === "cloudshare_participants") return !summaryFilter || summaryFilter !== "cloudshare_participants";
    if (summaryFilter === "portal_attempts") return true;
    if (summaryFilter === "active" || summaryFilter === "in_progress" || summaryFilter === "completed") return attempt.summaryContributions?.includes(summaryFilter) ?? false;
    if (summaryFilter === "state_observations") return isCohortMonitoringStateObservation(attempt);
    return isCohortMonitoringProblem(attempt);
  });
  const visibleCloudShareParticipants = cloudShareParticipants.filter((participant) => {
    if (!summaryFilter || summaryFilter === "portal_attempts") return !summaryFilter || summaryFilter !== "portal_attempts";
    if (summaryFilter === "cloudshare_participants") return true;
    if (summaryFilter === "active" || summaryFilter === "in_progress" || summaryFilter === "completed") return participant.summaryContributions?.includes(summaryFilter) ?? false;
    if (summaryFilter === "state_observations") return isCohortMonitoringStateObservation(participant);
    return isCohortMonitoringProblem(participant);
  });

  return (
    <div style={{ ...cardStyle, display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <h3 style={{ margin: 0 }}>{isMonitoring ? "Cohort Exam Session monitoring" : "Cohort Exam Session workspace"}</h3>
          <p style={{ margin: 0, color: colors.textSecondary }}>{props.examTitle}</p>
          {isMonitoring ? (
            <p style={{ margin: 0, color: colors.textSecondary }}>Current Candidate attempts and shared CloudShare Experience state.</p>
          ) : <CohortSessionDraftOnlyNotice />}
        </div>
        <button type="button" onClick={props.onBack} style={secondaryButtonStyle}>
          Back to Cohort Sessions
        </button>
      </div>

      <div style={{ display: "grid", gap: "0.9rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{session.session.name}</div>
          <span style={statusBadgeStyle(getCohortSessionStatusTone(session.session.status))}>
            {formatCohortSessionStatus(session.session.status)}
          </span>
        </div>

        {!isMonitoring && session.session.status === "draft" ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button type="button" onClick={props.onPublish} disabled={props.loading} style={primaryButtonStyle}>
              Publish Cohort Session
            </button>
          </div>
        ) : null}
        {!isMonitoring && (session.session.status === "published" || session.session.status === "closed") ? (
          <div style={{ display: "flex", justifyContent: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
            {session.session.status === "published" ? (
              <button
                type="button"
                onClick={props.onCloseAdmission}
                disabled={props.loading}
                style={secondaryButtonStyle}
              >
                Close admission
              </button>
            ) : null}
            <button type="button" onClick={props.onRetire} disabled={props.loading} style={secondaryButtonStyle}>
              Retire session
            </button>
          </div>
        ) : null}

        <div style={cohortSessionDetailGridStyle}>
          <CohortSessionDetailItem

            label="Admission opens"
            value={formatCohortSessionDateTime(session.session.admissionStartsAt)}
          />
          <CohortSessionDetailItem
            label="Admission closes"
            value={formatCohortSessionDateTime(session.session.admissionEndsAt)}
          />
          <CohortSessionDetailItem
            label="Capacity"
            value={session.session.capacity === null ? "Unlimited" : session.session.capacity}
          />
          {getCloudShareIdentifierFields(session.session).map((field) => (
            <CohortSessionDetailItem key={field.label} label={field.label} value={field.value} />
          ))}
          {session.session.publishedAt ? (
            <CohortSessionDetailItem
              label="Published at"
              value={formatCohortSessionDateTime(session.session.publishedAt)}
            />
          ) : null}
          {session.session.admissionClosedAt ? (
            <CohortSessionDetailItem
              label="Admission closed at"
              value={formatCohortSessionDateTime(session.session.admissionClosedAt)}
            />
          ) : null}
          {session.session.retiredAt ? (
            <CohortSessionDetailItem
              label="Retired at"
              value={formatCohortSessionDateTime(session.session.retiredAt)}
            />
          ) : null}
        </div>

        {session.session.lastPublishError ? (
          <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.25rem" }}>
            <strong>
              {session.session.status === "publish_reconciliation_required"
                ? "Publish reconciliation required"
                : "Last publish attempt failed"}
            </strong>
            <span>{session.session.lastPublishError}</span>
            {session.session.lastPublishCorrelationId ? (
              <span>
                Correlation ID:{" "}
                <CorrelationDiagnosticsLink
                  correlationId={session.session.lastPublishCorrelationId}
                  getNavigationHref={props.getNavigationHref}
                  onNavigate={props.onNavigate}
                />
              </span>
            ) : null}
          </div>
        ) : null}

        {!isMonitoring && props.onOpenMonitoring ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button type="button" onClick={props.onOpenMonitoring} style={secondaryButtonStyle}>
              Open in Session Monitoring
            </button>
          </div>
        ) : null}

        <div style={cohortSessionDetailGridStyle}>
          <CohortSessionDetailItem label="Project" value={session.inheritedContext.project.name} />
          <CohortSessionDetailItem
            label="Blueprint/default Snapshot"
            value={`${session.inheritedContext.blueprint.name} / ${session.inheritedContext.snapshot.name}`}
          />
          <CohortSessionDetailItem label="Policy" value={session.inheritedContext.policy.name} />
          <CohortSessionDetailItem
            label="Allowed Regions"
            value={session.inheritedContext.allowedRegions.map((region) => region.name).join(", ")}
          />
          <CohortSessionDetailItem label="Instructor" value={session.inheritedContext.instructor.name} />
          <CohortSessionDetailItem
            label="Guided Journey score retrieval"
            value={session.inheritedContext.scoreRetrievalEnabled ? "Enabled" : "Off"}
          />
          <CohortSessionDetailItem
            label="Time limit"
            value={`${session.inheritedContext.timeLimitMinutes} minutes`}
          />
        </div>

        {isMonitoring && props.detail ? (
          <div style={{ display: "grid", gap: "0.9rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <strong>Session monitoring</strong>
              {props.lastCheckedAt ? <span style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>Last checked: {formatAdminUtcTimestamp(props.lastCheckedAt)}</span> : null}
              {props.onRefresh ? <button type="button" onClick={props.onRefresh} style={secondaryButtonStyle}>Refresh session</button> : null}
              <a
                href={props.getNavigationHref?.(
                  createSupportDiagnosticsNavigationIntent(props.detail.diagnostics.session),
                )}
                style={secondaryButtonStyle}
                title="Open Support Diagnostics filtered to this Cohort Exam Session."
                onClick={(event) => {
                  if (props.onNavigate) {
                    event.preventDefault();
                    props.onNavigate(
                      createSupportDiagnosticsNavigationIntent(props.detail!.diagnostics.session),
                    );
                  }
                }}
              >
                Session diagnostics
              </a>
            </div>

            <div style={cohortSessionDetailGridStyle}>
              <CohortSessionMonitoringSummaryItem
                label="Active"
                value={props.detail.summary.activeCount}
                help="Portal attempts or CloudShare participants that are currently non-terminal for this Cohort Exam Session."
                selected={summaryFilter === "active"}
                onSelect={() => setSummaryFilter("active")}
              />
              <CohortSessionMonitoringSummaryItem
                label="In progress"
                value={props.detail.summary.inProgressCount}
                help="Portal attempts or CloudShare participants currently reported as in progress."
                selected={summaryFilter === "in_progress"}
                onSelect={() => setSummaryFilter("in_progress")}
              />
              <CohortSessionMonitoringSummaryItem
                label="Completed"
                value={props.detail.summary.completedCount}
                help="Portal attempts or CloudShare participants currently reported as completed."
                selected={summaryFilter === "completed"}
                onSelect={() => setSummaryFilter("completed")}
              />
              <CohortSessionMonitoringSummaryItem
                label="Needs attention"
                value={props.detail.summary.needsAttentionCount ?? props.detail.summary.problemCount}
                help="True runtime contradictions, missing correlations, or a failed CloudShare participant read."
                selected={summaryFilter === "problems"}
                onSelect={() => setSummaryFilter("problems")}
              />
              <CohortSessionMonitoringSummaryItem
                label="State observations"
                value={props.detail.summary.stateObservationCount ?? 0}
                help="New state differences are observed once before becoming actionable, so transient updates do not cause unnecessary alarm."
                selected={summaryFilter === "state_observations"}
                onSelect={() => setSummaryFilter("state_observations")}
                tone="informational"
              />
              <CohortSessionMonitoringSummaryItem
                label="Session exam attempts"
                value={props.detail.summary.portalAttemptCount}
                help="Rows from Certalis portal state: Candidates who have an ExamAttempt for this Cohort Exam Session."
                selected={summaryFilter === "portal_attempts"}
                onSelect={() => setSummaryFilter("portal_attempts")}
              />
              <CohortSessionMonitoringSummaryItem
                label="CloudShare participants"
                value={props.detail.summary.cloudShareParticipantCount}
                help="Rows returned by CloudShare for the shared Experience/training used by this Cohort Exam Session."
                selected={summaryFilter === "cloudshare_participants"}
                onSelect={() => setSummaryFilter("cloudshare_participants")}
              />
            </div>

            {summaryFilter ? (
              <div role="status" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", color: colors.textSecondary }}>
                <span>Showing rows contributing to: <strong style={{ color: colors.textPrimary }}>{cohortMonitoringSummaryFilterLabel[summaryFilter]}</strong></span>
                <button type="button" onClick={() => setSummaryFilter(null)} style={secondaryButtonStyle}>Clear summary filter</button>
              </div>
            ) : null}

            <div style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>
              Counts are derived from session exam attempts and the CloudShare participant read for this shared Experience.
            </div>
            {(props.detail.summary.stateObservationCount ?? 0) > 0 ? <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>State observations detected. They will need attention only if they remain after the next automatic refresh.</div> : null}
            <CohortSessionAttentionSummary
              problemCount={props.detail.summary.needsAttentionCount ?? props.detail.summary.problemCount}
              portalProblemRows={portalProblemRows}
              cloudShareProblemRows={cloudShareProblemRows}
              cloudShareReadUnavailable={props.detail.cloudShareParticipants.status === "unavailable"}
              cloudShareReadRateLimited={props.detail.cloudShareParticipants.status === "rate_limited"}
            />

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <strong>Session exam attempts</strong>
              </div>
              {visiblePortalAttempts.length === 0 ? (
                <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
                  {summaryFilter === "state_observations" ? "No rows need a second state observation check on this refresh." : summaryFilter ? "No session exam attempts contribute to this summary count." : "No session exam attempts have joined this Cohort Exam Session yet."}
                </div>
              ) : (
                <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr style={{ background: colors.surfaceSubtle }}>
                        {["Candidate", "Attempt state", "CloudShare IDs", "Reconciliation", "Diagnostics"].map((heading) => (
                          <th key={heading} style={{ textAlign: "left", padding: "0.55rem", borderBottom: `1px solid ${colors.border}` }}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePortalAttempts.map((attempt) => (
                        <tr
                          key={attempt.id}
                          style={
                            (attempt.reconciliation ?? (attempt.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention"
                              ? reconciliationWarningRowStyle
                              : { borderBottom: `1px solid ${colors.border}` }
                          }
                        >
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            <div style={{ fontWeight: 600 }}>{attempt.candidateName}</div>
                            <div style={{ color: colors.textSecondary }}>{attempt.candidateEmail}</div>
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            <div>{formatAdminAttemptStatus(attempt.status)}</div>
                            <div style={{ color: colors.textSecondary }}>{formatAdminUtcTimestamp(attempt.scheduledFor)}</div>
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top", overflowWrap: "anywhere" }}>
                            <div>Attempt ID: {attempt.id}</div>
                            <div>Participant ID: {attempt.participantId ?? "-"}</div>
                            <div>Environment ID: {attempt.environmentId ?? attempt.environmentExternalId ?? "-"}</div>
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            {(attempt.reconciliation ?? (attempt.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention" ? (
                              <AttentionGuidance reasons={attempt.problemReasons} />
                            ) : attempt.reconciliation === "state_observation" ? (
                              <span style={{ color: colors.textSecondary }}>State observation: checking again on the next refresh</span>
                            ) : attempt.reconciliation === "unknown" ? (
                              <span style={{ color: colors.textSecondary }}>Current CloudShare state is unavailable because participant monitoring is temporarily throttled; no reconciliation conclusion is available.</span>
                            ) : (
                              <span style={{ color: colors.textSecondary }}>Normal: portal and CloudShare runtime state agree</span>
                            )}
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            <button type="button" style={secondaryButtonStyle} onClick={() => setTimeline({
                              title: `Attempt timeline: ${attempt.candidateName}`,
                              events: [
                                `Certalis currently records this attempt as ${formatAdminAttemptStatus(attempt.status)}.`,
                                attempt.problemReasons[0] ?? "The portal and CloudShare runtime state currently agree.",
                                "CloudShare participant reads are checked again every 30 seconds while this session is open.",
                              ],
                              diagnostics: attempt.diagnosticFilters,
                            })}>
                              Attempt timeline
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <strong>Guided Journey aggregate progress</strong>

                {props.detail.diagnostics.guidedJourneyAggregateRead ? (
                  <a
                    href={props.getNavigationHref?.(
                      createSupportDiagnosticsNavigationIntent(
                        props.detail.diagnostics.guidedJourneyAggregateRead,
                      ),
                    )}
                    style={secondaryButtonStyle}
                  >
                    Aggregate progress diagnostics
                  </a>
                ) : null}
              </div>
              <div style={{ color: colors.textSecondary, fontSize: "0.9rem" }}>
                This Cohort Exam Session / CloudShare Experience aggregate is admin-only and does not represent cross-Experience analytics.
              </div>
              <GuidedJourneyAggregatePanel
                detail={props.detail.guidedJourneyAggregate}
                getNavigationHref={props.getNavigationHref}
                onNavigate={props.onNavigate}
              />
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <strong>CloudShare participants</strong>
                {props.detail.diagnostics.cloudShareRead ? (
                  <a
                    href={props.getNavigationHref?.(
                      createSupportDiagnosticsNavigationIntent(props.detail.diagnostics.cloudShareRead),
                    )}
                    style={secondaryButtonStyle}
                    title="Open Support Diagnostics filtered to the CloudShare participant-list check for this Cohort Exam Session."
                  >
                    Participant check diagnostics
                  </a>
                ) : null}
              </div>
              {props.detail.cloudShareParticipants.status === "rate_limited" ? (
                <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.35rem" }}>
                  <strong>CloudShare participant roster refresh is rate limited</strong>
                  <span>{props.detail.cloudShareParticipants.readError}</span>
                  <span>
                    CloudShare did not provide current participant state for this check. This is not a participant reconciliation failure.
                  </span>
                  {props.detail.cloudShareParticipants.retryAfterSeconds !== undefined ? (
                    <span>Retry after {props.detail.cloudShareParticipants.retryAfterSeconds} seconds.</span>
                  ) : null}
                  {props.detail.cloudShareParticipants.correlationId ? (
                    <span>
                      Correlation ID:{" "}
                      <CorrelationDiagnosticsLink
                        correlationId={props.detail.cloudShareParticipants.correlationId}
                        getNavigationHref={props.getNavigationHref}
                        onNavigate={props.onNavigate}
                      />
                    </span>
                  ) : null}
                </div>
              ) : null}
              {props.detail.cloudShareParticipants.status === "unavailable" ? (
                <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.35rem" }}>
                  <strong>CloudShare participant read unavailable</strong>
                  <span>{props.detail.cloudShareParticipants.readError}</span>
                  {props.detail.cloudShareParticipants.correlationId ? (
                    <span>
                      Correlation ID:{" "}
                      <CorrelationDiagnosticsLink
                        correlationId={props.detail.cloudShareParticipants.correlationId}
                        getNavigationHref={props.getNavigationHref}
                        onNavigate={props.onNavigate}
                      />
                    </span>
                  ) : null}
                </div>
              ) : null}
              {props.detail.cloudShareParticipants.status === "not_published" ? (
                <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
                  Publish this Cohort Exam Session to CloudShare before participant monitoring becomes available.
                </div>
              ) : null}
              {props.detail.cloudShareParticipants.status !== "not_published" &&
              props.detail.cloudShareParticipants.status !== "rate_limited" &&
              visibleCloudShareParticipants.length === 0 ? (
                <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
                  {summaryFilter === "state_observations" ? "No rows need a second state observation check on this refresh." : summaryFilter ? "No CloudShare participants contribute to this summary count." : "No CloudShare participants are currently visible for this shared Experience."}
                </div>
              ) : null}
              {visibleCloudShareParticipants.length > 0 ? (
                <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                    <thead>
                      <tr style={{ background: colors.surfaceSubtle }}>
                        {["Participant", "CloudShare state", "Portal match", "Reconciliation", "Diagnostics"].map((heading) => (
                          <th key={heading} style={{ textAlign: "left", padding: "0.55rem", borderBottom: `1px solid ${colors.border}` }}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCloudShareParticipants.map((participant) => (
                        <tr
                          key={`${participant.email}:${participant.studentId ?? participant.environmentId ?? "none"}`}
                          style={
                            (participant.reconciliation ?? (participant.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention"
                              ? reconciliationWarningRowStyle
                              : { borderBottom: `1px solid ${colors.border}` }
                          }
                        >
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            <div style={{ fontWeight: 600 }}>{participant.displayName ?? participant.email}</div>
                            <div style={{ color: colors.textSecondary }}>{participant.email}</div>
                            <div style={{ color: colors.textSecondary }}>First joined: {formatAdminUtcTimestamp(participant.firstJoinedAt)}</div>
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top", overflowWrap: "anywhere" }}>
                            <div>Participation: {formatCloudShareMonitoringStatus(participant.participationStatus)}</div>
                            <div>Environment: {formatCloudShareMonitoringStatus(participant.environmentStatus)}</div>
                            <div>Environment ID: {participant.environmentId ?? "-"}</div>
                            <div>Participant ID: {participant.studentId ?? "-"}</div>
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            {participant.matchedExamAttemptId ? participant.matchedExamAttemptId : "No session exam attempt"}
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            {(participant.reconciliation ?? (participant.problemReasons.length > 0 ? "needs_attention" : "normal")) === "needs_attention" ? (
                              <AttentionGuidance reasons={participant.problemReasons} />
                            ) : participant.reconciliation === "state_observation" ? (
                              <span style={{ color: colors.textSecondary }}>State observation: checking again on the next refresh</span>
                            ) : participant.reconciliation === "unknown" ? (
                              <span style={{ color: colors.textSecondary }}>Current CloudShare state is unavailable because participant monitoring is temporarily throttled; no reconciliation conclusion is available.</span>
                            ) : (
                              <span style={{ color: colors.textSecondary }}>Normal: portal and CloudShare runtime state agree</span>
                            )}
                          </td>
                          <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                            <button type="button" style={secondaryButtonStyle} onClick={() => setTimeline({
                              title: `Participant correlation: ${participant.displayName ?? participant.email}`,
                              events: [
                                `CloudShare reports environment state as ${participant.environmentStatus ?? "unavailable"}.`,
                                `CloudShare reports participation as ${participant.participationStatus ?? "unavailable"}; this is membership context, not runtime authority.`,
                                participant.problemReasons[0] ?? "The participant is correlated to the portal attempt without an actionable contradiction.",
                              ],
                              diagnostics: participant.diagnosticFilters,
                            })}>
                              Participant correlation diagnostics
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            {timeline ? (
              <section ref={timelineRef} role="region" style={{ position: "fixed", inset: "15% 15% auto", zIndex: 20, ...cardStyle, display: "grid", gap: "0.75rem", maxHeight: "70vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(15,23,42,.28)" }} aria-label="Monitoring timeline explanation">
                <strong>{timeline.title}</strong>
                <ol style={{ margin: 0, paddingLeft: "1.25rem" }}>{timeline.events.map((event) => <li key={event}>{event}</li>)}</ol>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setTimeline(null)}>Close timeline</button>
                  <a
                    href={props.getNavigationHref?.(
                      createSupportDiagnosticsNavigationIntent(timeline.diagnostics),
                    )}
                    onClick={(event) => {
                      if (!props.onNavigate) return;
                      event.preventDefault();
                      props.onNavigate(createSupportDiagnosticsNavigationIntent(timeline.diagnostics));
                    }}
                    style={secondaryButtonStyle}
                  >
                    View forensic logs
                  </a>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatCloudShareMonitoringStatus(status: string | null): string {
  if (!status) return "-";
  return status
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function AttentionGuidance(props: { readonly reasons: readonly string[] }) {
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <ProblemReasonList reasons={props.reasons} />
      <span style={{ color: colors.textSecondary }}>Refresh now. If this remains after the next check, open the linked timeline to inspect the relevant events.</span>
    </div>
  );
}

export function CohortSessionMonitoringList(props: {
  readonly sessions: readonly { readonly exam: ExamRecord; readonly session: CohortExamSessionRecord }[];
  readonly onOpen: (examId: string, sessionId: string) => void;
}) {
  return (
    <section style={{ ...cardStyle, display: "grid", gap: "0.75rem" }} aria-label="Cohort Exam Session monitoring">
      <div>
        <h2 style={{ margin: 0, fontSize: "1rem" }}>Cohort Exam Sessions</h2>
        <p style={{ margin: "0.35rem 0 0", color: colors.textSecondary }}>
          Shared CloudShare Experiences grouped by Cohort Exam Session.
        </p>
      </div>
      {props.sessions.length === 0 ? (
        <p style={{ margin: 0, color: colors.textSecondary }}>No Cohort Exam Sessions are available for monitoring.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {props.sessions.map(({ exam, session }) => (
            <div key={session.session.id} style={{ ...mutedPanelStyle, display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.15rem" }}>
                <strong>{session.session.name}</strong>
                <span style={{ color: colors.textSecondary }}>{exam.title} · {formatCohortSessionStatus(session.session.status)}</span>
              </div>
              <button type="button" onClick={() => props.onOpen(exam.id, session.session.id)} style={secondaryButtonStyle}>
                Open monitoring
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GuidedJourneyAggregatePanel(props: {
  readonly detail: CohortExamSessionGuidedJourneyAggregateView;
  readonly getNavigationHref?: (intent: AdminNavigationIntent) => string;
  readonly onNavigate?: (intent: AdminNavigationIntent) => void;
}) {
  const detail = props.detail;

  if (detail.status === "disabled") {
    return (
      <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
        Enable Guided Journey score retrieval on the parent Exam to view shared Experience aggregate progress.
      </div>
    );
  }

  if (detail.status === "not_published") {
    return (
      <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
        Publish this Cohort Exam Session to CloudShare before shared Experience aggregate progress becomes available.
      </div>
    );
  }

  if (detail.status === "unavailable" || !detail.progress) {
    return (
      <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.35rem" }}>
        <strong>Aggregate Guided Journey progress unavailable</strong>
        <span>{detail.readError ?? "Aggregate Guided Journey progress is unavailable."}</span>
        {detail.correlationId ? (
          <span>
            Correlation ID:{" "}
            <CorrelationDiagnosticsLink
              correlationId={detail.correlationId}
              getNavigationHref={props.getNavigationHref}
              onNavigate={props.onNavigate}
            />
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={cohortSessionDetailGridStyle}>
        <CohortSessionDetailItem label="Experience ID" value={detail.experienceId ?? "-"} />
        <CohortSessionDetailItem label="Explored" value={formatRateSummary(detail.progress.avgExploredRate)} />
        <CohortSessionDetailItem label="In progress" value={formatRateSummary(detail.progress.avgInProgressRate)} />
        <CohortSessionDetailItem label="Not started" value={formatRateSummary(detail.progress.avgNotStartedRate)} />
        <CohortSessionDetailItem label="Passed" value={formatRateSummary(detail.progress.avgPassedRate)} />
        <CohortSessionDetailItem label="Failed" value={formatRateSummary(detail.progress.avgFailedRate)} />
        <CohortSessionDetailItem label="Not initiated" value={formatRateSummary(detail.progress.avgNotInitiatedRate)} />
      </div>

      {detail.progress.aggSectionStatuses.length === 0 ? (
        <div style={{ ...mutedPanelStyle, color: colors.textSecondary }}>
          No section-level aggregate Guided Journey progress is currently visible for this shared Experience.
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ background: colors.surfaceSubtle }}>
                {["Section", "Aggregate status", "Rates", "Avg time"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", padding: "0.55rem", borderBottom: `1px solid ${colors.border}` }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.progress.aggSectionStatuses.map((section) => (
                <tr key={`${section.sectionNumber}:${section.title}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 600 }}>{section.title}</div>
                    <div style={{ color: colors.textSecondary }}>Section {section.sectionNumber + 1}</div>
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>{section.status ?? "-"}</td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <div>{formatRateSummary(section.avgExploredRate)} explored</div>
                    <div>{formatRateSummary(section.avgPassedRate)} passed</div>
                    <div>{formatRateSummary(section.avgFailedRate)} failed</div>
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    {section.avgTimeSpentSeconds === null ? "-" : `${Math.round(section.avgTimeSpentSeconds)}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
