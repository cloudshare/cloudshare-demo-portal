"use client";

import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  buildAdminNavigationHref,
  createCorrelationDiagnosticsNavigationIntent,
  createSupportDiagnosticsNavigationIntent,
  getAdminTabLabel,
  getAdminSupportViewLabel,
  shouldClearAdminBannerOnTabChange,
  type AdminExamView,
  type AdminNavigationIntent,
  type AdminSupportView,
  type AdminTab,
  type DiagnosticLogFilters,
} from "./admin-shell-route";
import {
  ADMIN_SESSION_EXPIRED_MESSAGE,
  createAdminAuthenticatedRequest,
  isAdminSessionExpiredError,
} from "./admin-authenticated-request";
import { CloudShareConnectionFeature } from "./admin-cloudshare-connection";
import { AdminCandidateRosterFeature } from "./admin-candidate-roster";
import { formatAdminAttemptStatus, formatAdminUtcTimestamp } from "./admin-attempt-presentation";
import { AdminSupportFeature } from "./admin-support";
import { AdminSessionMonitoringFeature } from "./admin-session-monitoring";
import {
  AdminExamCatalogAuthoringFeature,
  ExamCatalogLoadingOverlay,
  isCohortSessionAuthoringAvailable,
  type ExamRecord as CatalogExamRecord,
} from "./admin-exam-catalog-authoring";
import type {
  CohortExamSessionGuidedJourneyAggregateView,
  CohortExamSessionMonitoringView,
} from "@/api/admin-cohort-exam-session-detail";
import { startPortalSessionWatchdog } from "./session-expiry";
import { pageShellStyle } from "./page-shell";
import { cardStyle, mutedPanelStyle, alertPanelStyle } from "./card-styles";
import {
  accountLogoutButtonStyle,
  compactButtonStyle,
  disabledButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./button-styles";
import { colors } from "./design-tokens";
import { statusBadgeStyle, getExamStatusTone, type StatusTone } from "./status-badge";
import { PortalPageHeader } from "./portal-page-header";

const extensionHydrationProps = {
  suppressHydrationWarning: true,
} as const;

interface AdminConsoleProps {
  readonly email: string;
  readonly initialTab?: AdminTab;
  readonly initialExamView?: AdminExamView;
  readonly initialExamId?: string;
  readonly initialCohortSessionId?: string;
  readonly initialSupportView?: AdminSupportView;
  readonly initialDiagnosticFilters?: DiagnosticLogFilters;
}

interface AdminErrorState {
  readonly message: string;
  readonly correlationId?: string | null;
}

interface ExamRecord extends CatalogExamRecord {}

interface CohortExamSessionRecord {
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

interface CohortExamSessionFormState {
  name: string;
  admissionStartsAt: string;
  admissionEndsAt: string;
  capacity: string;
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

const adminTabNavStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))",
  gap: "0.5rem",
  marginBottom: "1rem",
  borderBottom: `1px solid ${colors.border}`,
  paddingBottom: "0.5rem",
  alignItems: "stretch",
};

const adminTabButtonStyle: React.CSSProperties = {
  padding: "0.6rem 0.9rem",
  border: "1px solid",
  borderRadius: "8px",
  width: "100%",
  minHeight: "2.75rem",
  textAlign: "center",
};

const examCatalogBusyShellStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
};

function getLogoutButtonStyle(disabled: boolean): React.CSSProperties {
  return disabled
    ? {
        ...accountLogoutButtonStyle,
        ...disabledButtonStyle,
      }
    : accountLogoutButtonStyle;
}

function formatExamDeliveryAvailability(value: ExamRecord["deliveryAvailability"]): string {
  if (value === "cohort") return "Cohort Exam";
  if (value === "both") return "Individual + Cohort Exam";
  return "Individual Exam";
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

function CohortSessionDraftControls(props: {
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

const examWorkspaceBreadcrumbNavStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.45rem",
  margin: 0,
  padding: 0,
  listStyle: "none",
  alignItems: "center",
};

const examWorkspaceBreadcrumbButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: "0.4rem 0.7rem",
  fontSize: "0.85rem",
  background: colors.surfaceSubtle,
  borderColor: colors.border,
};

const examWorkspaceBreadcrumbCurrentStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.4rem 0.7rem",
  borderRadius: "999px",
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: colors.textPrimary,
  fontSize: "0.85rem",
  fontWeight: 600,
};

export function ExamWorkspaceBreadcrumbs(props: {
  readonly examView: AdminExamView;
  readonly focusedExamTitle: string | null;
  readonly focusedSessionName?: string | null;
  readonly onNavigateToCatalog: () => void;
  readonly onNavigateToSessions?: () => void;
}) {
  const items: Array<{ key: string; label: string; current: boolean; onClick?: () => void }> = [
    {
      key: "catalog",
      label: "Catalog overview",
      current: props.examView === "catalog",
      onClick: props.examView === "catalog" ? undefined : props.onNavigateToCatalog,
    },
  ];

  if (props.examView === "edit" || props.examView === "create") {
    items.push({
      key: props.examView,
      label: props.examView === "edit" ? "Edit Exam" : "Create Exam",
      current: true,
    });
  }

  if ((props.examView === "sessions" || props.examView === "session") && props.focusedExamTitle) {
    items.push({
      key: "sessions",
      label: `Cohort Sessions: ${props.focusedExamTitle}`,
      current: props.examView === "sessions",
      onClick: props.examView === "session" ? props.onNavigateToSessions : undefined,
    });
  }

  if (props.examView === "session" && props.focusedSessionName) {
    items.push({
      key: "session",
      label: props.focusedSessionName,
      current: true,
    });
  }

  return (
    <nav aria-label="Exam workspace">
      <ol style={examWorkspaceBreadcrumbNavStyle}>
        {items.map((item, index) => (
          <React.Fragment key={item.key}>
            {index > 0 ? (
              <li aria-hidden="true" style={{ color: colors.textMuted }}>
                /
              </li>
            ) : null}
            <li>
              {item.current ? (
                <span aria-current="page" style={examWorkspaceBreadcrumbCurrentStyle}>
                  {item.label}
                </span>
              ) : (
                <button type="button" onClick={item.onClick} style={examWorkspaceBreadcrumbButtonStyle}>
                  {item.label}
                </button>
              )}
            </li>
          </React.Fragment>
        ))}
      </ol>
    </nav>
  );
}

export function AdminConsole({
  email,
  initialTab = "exams",
  initialExamView = "catalog",
  initialExamId,
  initialCohortSessionId,
  initialSupportView = "monitoring",
  initialDiagnosticFilters = {},
}: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [examView, setExamView] = useState<AdminExamView>(initialExamView);
  const [focusedExamId, setFocusedExamId] = useState<string | null>(initialExamId ?? null);
  const [focusedCohortSessionId, setFocusedCohortSessionId] = useState<string | null>(initialCohortSessionId ?? null);
  const [supportView, setSupportView] = useState<AdminSupportView>(initialSupportView);
  const [examCatalog, setExamCatalog] = useState<ExamRecord[]>([]);
  const [archivedExamCatalog, setArchivedExamCatalog] = useState<ExamRecord[]>([]);
  const [cohortSessionsByExamId, setCohortSessionsByExamId] = useState<Record<string, CohortExamSessionRecord[]>>({});
  const cohortSessionCacheRef = useRef<Record<string, CohortExamSessionRecord[]>>({});
  const cohortSessionLoadsRef = useRef(new Map<string, Promise<void>>());
  const [cohortSessionFormsByExamId, setCohortSessionFormsByExamId] = useState<Record<string, CohortExamSessionFormState>>({});
  const [selectedCohortSession, setSelectedCohortSession] = useState<CohortExamSessionRecord | null>(null);
  const [examMessage, setExamMessage] = useState<string | null>(null);
  const examCatalogLoadingCountRef = useRef(0);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(initialDiagnosticFilters);
  const [loading, setLoading] = useState(false);
  const [examCatalogLoading, setExamCatalogLoading] = useState(false);
  const [errorState, setErrorState] = useState<AdminErrorState | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const error = errorState?.message ?? null;
  const allExamCatalog = [...examCatalog, ...archivedExamCatalog];

  function setError(message: string | null) {
    setErrorState(message === null ? null : { message, correlationId: null });
  }

  function setErrorWithCorrelation(message: string, correlationId?: string | null) {
    setErrorState({ message, correlationId: correlationId ?? null });
  }

  useEffect(() => {
    if (tab === "exams" && (examView === "sessions" || examView === "session")) {
      void loadExamCatalog();
    }
    if (tab === "support" && supportView === "monitoring") {
      void loadExamCatalog(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, examView, supportView]);

  useEffect(() => {
    if (tab !== "exams" || (examView !== "sessions" && examView !== "session") || !focusedExamId) {
      return;
    }
    void loadCohortExamSessions(focusedExamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, examView, focusedExamId]);

  function beginExamCatalogLoading() {
    examCatalogLoadingCountRef.current += 1;
    setExamCatalogLoading(true);
  }

  function endExamCatalogLoading() {
    examCatalogLoadingCountRef.current = Math.max(0, examCatalogLoadingCountRef.current - 1);
    setExamCatalogLoading(examCatalogLoadingCountRef.current > 0);
  }

  const handleAdminSessionExpired = useCallback(() => {
    setSessionExpired(true);
    setError(ADMIN_SESSION_EXPIRED_MESSAGE);
    router.replace("/login");
    router.refresh();
  }, [router]);

  const fetchAdmin = useMemo(
    () => createAdminAuthenticatedRequest({ fetchImpl: fetch, onSessionExpired: handleAdminSessionExpired }),
    [handleAdminSessionExpired],
  );

  const getNavigationHref = useCallback(
    (intent: AdminNavigationIntent) => buildAdminNavigationHref(intent),
    [],
  );

  useEffect(() => {
    if (sessionExpired) {
      return;
    }

    const watchdog = startPortalSessionWatchdog({
      fetchImpl: fetch,
      onExpired: handleAdminSessionExpired,
    });
    void watchdog.checkNow();

    return () => watchdog.stop();
  }, [handleAdminSessionExpired, sessionExpired]);

  function navigateAdmin(next: AdminNavigationIntent) {
    const nextDiagnosticFilters = next.diagnosticFilters ?? diagnosticFilters;
    const nextExamView = next.examView ?? "catalog";
    const nextSupportView = next.supportView ?? "monitoring";
    router.push(buildAdminNavigationHref({
      tab: next.tab,
      examView: nextExamView,
      examId: next.examId,
      cohortSessionId: next.cohortSessionId,
      supportView: nextSupportView,
      diagnosticFilters: nextDiagnosticFilters,
    }));
    setTab(next.tab);
    setExamView(nextExamView);
    setFocusedExamId(next.examId ?? null);
    setFocusedCohortSessionId(next.cohortSessionId ?? null);
    setSupportView(nextSupportView);
    setDiagnosticFilters(nextDiagnosticFilters);
  }

  function navigateToExamCatalog() {
    setSelectedCohortSession(null);
    navigateAdmin({ tab: "exams", examView: "catalog" });
  }
  function navigateToExamSessions(examId: string) {
    setSelectedCohortSession(null);
    navigateAdmin({ tab: "exams", examView: "sessions", examId });
    void loadCohortExamSessions(examId);
  }

  async function loadExamCatalog(loadCohortSessions = true) {
    beginExamCatalogLoading();
    try {
      const response = await fetchAdmin("/api/admin/exams");
      const data = (await response.json()) as {
        activeExams?: ExamRecord[];
        archivedExams?: ExamRecord[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Failed to load exam catalog");
        return;
      }
      const nextExams = data.activeExams ?? [];
      const nextArchivedExams = data.archivedExams ?? [];
      setExamCatalog(nextExams);
      setArchivedExamCatalog(nextArchivedExams);
      await Promise.all(
        nextExams
          .filter((exam) => loadCohortSessions || !cohortSessionCacheRef.current[exam.id])
          .map((exam) => loadCohortExamSessions(exam.id)),
      );
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load exam catalog");
    } finally {
      endExamCatalogLoading();
    }
  }

  async function loadCohortExamSessions(examId: string) {
    const inFlight = cohortSessionLoadsRef.current.get(examId);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions`);
        const data = (await response.json()) as { sessions?: CohortExamSessionRecord[]; error?: string };
        if (!response.ok) {
          setError(data.error ?? "Failed to load Cohort Exam Sessions");
          return;
        }
        const sessions = data.sessions ?? [];
        cohortSessionCacheRef.current = { ...cohortSessionCacheRef.current, [examId]: sessions };
        setCohortSessionsByExamId((current) => ({ ...current, [examId]: sessions }));
      } catch (caughtError) {
        if (!isAdminSessionExpiredError(caughtError)) setError("Failed to load Cohort Exam Sessions");
      } finally {
        cohortSessionLoadsRef.current.delete(examId);
      }
    })();
    cohortSessionLoadsRef.current.set(examId, request);
    return request;
  }

  function getCohortSessionForm(examId: string): CohortExamSessionFormState {
    return cohortSessionFormsByExamId[examId] ?? {
      name: "",
      admissionStartsAt: "",
      admissionEndsAt: "",
      capacity: "",
    };
  }

  function updateCohortSessionForm(examId: string, patch: Partial<CohortExamSessionFormState>) {
    setCohortSessionFormsByExamId((current) => ({
      ...current,
      [examId]: {
        ...(current[examId] ?? { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" }),
        ...patch,
      },
    }));
  }

  async function createDraftCohortSession(examId: string) {
    const form = getCohortSessionForm(examId);
    const admissionStartsAt = normalizeAdminLocalDateTime(form.admissionStartsAt);
    const admissionEndsAt = normalizeAdminLocalDateTime(form.admissionEndsAt);
    setLoading(true);
    setError(null);
    setExamMessage(null);
    if (!admissionStartsAt) {
      setError("Choose a valid admission open date and time.");
      setLoading(false);
      return;
    }
    if (form.admissionEndsAt.trim() && !admissionEndsAt) {
      setError("Choose a valid admission close date and time.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          admissionStartsAt,
          admissionEndsAt,
          capacity: form.capacity ? Number(form.capacity) : null,
        }),
      });
      const data = (await response.json()) as CohortExamSessionRecord & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to create draft Cohort Exam Session");
        return;
      }
      setSelectedCohortSession(data);
      setExamMessage("Draft Cohort Exam Session created.");
      setCohortSessionFormsByExamId((current) => ({
        ...current,
        [examId]: { name: "", admissionStartsAt: "", admissionEndsAt: "", capacity: "" },
      }));
      await loadCohortExamSessions(examId);
      navigateAdmin({
        tab: "exams",
        examView: "session",
        examId,
        cohortSessionId: data.session.id,
      });
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to create draft Cohort Exam Session");
    } finally {
      setLoading(false);
    }
  }

  async function publishCohortSession(examId: string, sessionId: string) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}/publish`,
        { method: "POST" },
      );
      const data = (await response.json()) as CohortExamSessionRecord & { error?: string; correlationId?: string };
      if (!response.ok) {
        setErrorWithCorrelation(data.error ?? "Failed to publish Cohort Exam Session", data.correlationId);
        await loadCohortExamSessions(examId);
        return;
      }
      setSelectedCohortSession(data);
      setExamMessage("Cohort Exam Session published to CloudShare.");
      await loadCohortExamSessions(examId);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to publish Cohort Exam Session");
    } finally {
      setLoading(false);
    }
  }

  async function closeCohortSessionAdmission(examId: string, sessionId: string) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}/close-admission`,
        { method: "POST" },
      );
      const data = (await response.json()) as { session?: CohortExamSessionRecord["session"]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to close Cohort Exam Session admission");
        return;
      }
      setExamMessage("Cohort Exam Session admission closed.");
      await loadCohortExamSessions(examId);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to close Cohort Exam Session admission");
    } finally {
      setLoading(false);
    }
  }

  async function retireCohortSession(examId: string, sessionId: string, confirmInterrupt = false) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions/${encodeURIComponent(sessionId)}/retire`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(confirmInterrupt ? { confirmInterrupt: true } : {}),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        correlationId?: string;
        warning?: {
          activeParticipantCount?: number;
          nonTerminalEnvironmentCount?: number;
        };
      };
      if (response.status === 409 && data.code === "confirmation_required" && !confirmInterrupt) {
        const proceed = window.confirm(
          `Retire this Cohort Exam Session? ` +
            `${data.warning?.activeParticipantCount ?? 0} active participant(s) and ` +
            `${data.warning?.nonTerminalEnvironmentCount ?? 0} non-terminal environment(s) may be interrupted.`,
        );
        if (proceed) {
          await retireCohortSession(examId, sessionId, true);
        }
        return;
      }
      if (!response.ok) {
        setErrorWithCorrelation(data.error ?? "Failed to retire Cohort Exam Session", data.correlationId);
        return;
      }
      setExamMessage("Cohort Exam Session retired.");
      await loadCohortExamSessions(examId);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to retire Cohort Exam Session");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    setLoading(true);
    setError(null);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const focusedExam = focusedExamId ? (allExamCatalog.find((exam) => exam.id === focusedExamId) ?? null) : null;
  const focusedExamSessions = focusedExamId ? (cohortSessionsByExamId[focusedExamId] ?? []) : [];
  const focusedCohortSession =
    (focusedCohortSessionId
      ? focusedExamSessions.find((session) => session.session.id === focusedCohortSessionId)
      : null) ??
    (selectedCohortSession?.session.id === focusedCohortSessionId ? selectedCohortSession : null);
  const monitoredCohortSessions = allExamCatalog.flatMap((exam) =>
    (cohortSessionsByExamId[exam.id] ?? []).map((session) => ({ exam, session })),
  );
  if (sessionExpired) {
    return (
      <main style={pageShellStyle}>
        <h1 style={{ marginBottom: "0.5rem" }}>Admin session expired</h1>
        <p style={{ color: "#555" }}>{ADMIN_SESSION_EXPIRED_MESSAGE}</p>
        <button onClick={() => router.replace("/login")} style={{ padding: "0.55rem 0.9rem" }}>
          Go to login
        </button>
      </main>
    );
  }

  return (
    <main
      style={{
        ...pageShellStyle,
        minHeight: "100vh",
        scrollbarGutter: "stable",
      }}
    >
      <PortalPageHeader
        eyebrow="Helios Admin Portal"
        title="Certalis Admin Console"
        description="Manage the Helios CX CloudShare Connection, Exam catalog, Candidate accounts, and active exam attempt support workflows."
        email={email}
        actions={
          <button {...extensionHydrationProps} onClick={logout} disabled={loading} style={getLogoutButtonStyle(loading)}>
            Log out
          </button>
        }
      />
      <nav
        aria-label="Admin console sections"
        style={adminTabNavStyle}
      >
        {ADMIN_TABS.map((t) => {
          const isActive = tab === t;

          return (
            <button
              {...extensionHydrationProps}
              key={t}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (shouldClearAdminBannerOnTabChange(tab, t)) {
                  setError(null);
                }
                navigateAdmin({
                  tab: t,
                  examView: t === "exams" ? "catalog" : undefined,
                  supportView: t === "support" ? supportView : undefined,
                });
              }}
              style={{
                ...adminTabButtonStyle,
                background: isActive ? colors.textPrimary : t === "support" ? colors.accentSoft : "#ffffff",
                color: isActive ? "#ffffff" : "#111827",
                borderColor: isActive ? colors.textPrimary : t === "support" ? "#b9ded7" : "#d1d5db",
                cursor: "pointer",
                fontWeight: isActive ? 700 : 600,
                boxShadow: isActive ? "inset 0 -3px 0 #0f6d66" : "none",
              }}
            >
              {getAdminTabLabel(t)}
            </button>
          );
        })}
      </nav>

      {error && (
        <div style={{ ...alertPanelStyle.danger, display: "grid", gap: "0.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <p style={{ margin: 0 }}>{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{ padding: "0.25rem 0.55rem" }}
            >
              Dismiss
            </button>
          </div>
          {errorState?.correlationId ? (
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                Open <strong>Support Diagnostics</strong> filtered by correlation ID{" "}
                <CorrelationDiagnosticsLink
                  correlationId={errorState.correlationId}
                  getNavigationHref={getNavigationHref}
                  onNavigate={navigateAdmin}
                />
                .
              </p>
            </div>
          ) : null}
        </div>
      )}

      <AdminCandidateRosterFeature
        active={tab === "candidates"}
        fetchAdmin={fetchAdmin}
      />

      <CloudShareConnectionFeature
        active={tab === "configuration"}
        fetchAdmin={fetchAdmin}
        getNavigationHref={getNavigationHref}
        onNavigate={navigateAdmin}
        onBusyChange={setLoading}
      />

      {tab === "exams" && (examView === "catalog" || examView === "create" || examView === "edit") && (
        <AdminExamCatalogAuthoringFeature
          active
          examView={examView}
          focusedExamId={focusedExamId}
          fetchAdmin={fetchAdmin}
          onNavigate={navigateAdmin}
          onCatalogChange={({ activeExams, archivedExams }) => {
            const nextExams = [...activeExams];
            const nextArchivedExams = [...archivedExams];
            setExamCatalog(nextExams);
            setArchivedExamCatalog(nextArchivedExams);
            void Promise.all(nextExams.map((exam) => loadCohortExamSessions(exam.id)));
          }}
          getHasActiveCohortSessions={(examId) =>
            (cohortSessionsByExamId[examId] ?? []).some((session) => session.session.status !== "retired")
          }
        />
      )}

      {tab === "exams" && (examView === "sessions" || examView === "session") && (
        <section
          aria-busy={examCatalogLoading}
          style={{ ...examCatalogBusyShellStyle, display: "grid", gap: "1rem" }}
        >
          {examCatalogLoading ? <ExamCatalogLoadingOverlay /> : null}
          <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0 }}>Exam Catalog</h2>
                <p style={{ margin: "0.25rem 0 0", color: colors.textSecondary }}>
                  Overview of Exams and delivery options for Helios CX.
                </p>
              </div>
            </div>
            <ExamWorkspaceBreadcrumbs
              examView={examView}
              focusedExamTitle={focusedExam?.title ?? null}
              focusedSessionName={focusedCohortSession?.session.name ?? null}
              onNavigateToCatalog={navigateToExamCatalog}
              onNavigateToSessions={focusedExam ? () => navigateToExamSessions(focusedExam.id) : undefined}
            />
          </div>
          {examView === "sessions" && focusedExam && (
            <div style={{ ...cardStyle, display: "grid", gap: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0 }}>Cohort Exam Sessions</h3>
                  <p style={{ margin: "0.25rem 0 0", color: colors.textSecondary }}>
                    {focusedExam.title} · {formatExamDeliveryAvailability(focusedExam.deliveryAvailability)}
                  </p>
                  <CohortSessionDraftOnlyNotice />
                </div>
                <button type="button" onClick={navigateToExamCatalog} style={secondaryButtonStyle}>
                  Back to catalog
                </button>
              </div>
              {isCohortSessionAuthoringAvailable(focusedExam.deliveryAvailability) ? (
                <CohortSessionDraftControls
                  examId={focusedExam.id}
                  form={getCohortSessionForm(focusedExam.id)}
                  sessions={focusedExamSessions}
                  loading={loading}
                  onChange={(patch) => updateCohortSessionForm(focusedExam.id, patch)}
                  onCreate={() => void createDraftCohortSession(focusedExam.id)}
                  onSelect={(session) => {
                    setSelectedCohortSession(session);
                    navigateAdmin({
                      tab: "exams",
                      examView: "session",
                      examId: focusedExam.id,
                      cohortSessionId: session.session.id,
                    });
                  }}
                />
              ) : (
                <span style={{ color: colors.textSecondary }}>
                  Cohort Exam Sessions are unavailable for individual-only Exams.
                </span>
              )}
            </div>
          )}

          {examView === "session" && focusedExam && focusedCohortSession && (
          <CohortSessionWorkspacePanel
              examTitle={focusedExam.title}
              session={focusedCohortSession}
              loading={loading}
              onBack={() => navigateToExamSessions(focusedExam.id)}
              onPublish={() => void publishCohortSession(focusedExam.id, focusedCohortSession.session.id)}
              onCloseAdmission={() =>
                void closeCohortSessionAdmission(focusedExam.id, focusedCohortSession.session.id)
              }
              onRetire={() => void retireCohortSession(focusedExam.id, focusedCohortSession.session.id)}
              getNavigationHref={getNavigationHref}
              onNavigate={navigateAdmin}
              onOpenMonitoring={() =>
                navigateAdmin({
                  tab: "support",
                  supportView: "monitoring",
                  examId: focusedExam.id,
                  cohortSessionId: focusedCohortSession.session.id,
                })
              }
            />
          )}

          {examView === "session" && focusedExam && focusedCohortSessionId && !focusedCohortSession && (
            <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.5rem" }}>
              <p style={{ margin: 0 }}>Cohort Exam Session detail is not loaded yet.</p>
              <button type="button" onClick={() => void loadCohortExamSessions(focusedExam.id)} style={secondaryButtonStyle}>
                Refresh Cohort Sessions
              </button>
            </div>
          )}
        </section>
      )}

      {tab === "support" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.75rem" }}>
            <strong>Support workflows</strong>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(["monitoring", "diagnostics", "audit"] as const).map((view) => (
                <button
                  {...extensionHydrationProps}
                  key={view}
                  type="button"
                  aria-current={supportView === view ? "page" : undefined}
                  onClick={() => navigateAdmin({ tab: "support", supportView: view })}
                  style={{
                    padding: "0.5rem 0.8rem",
                    border: `1px solid ${supportView === view ? colors.textPrimary : colors.border}`,
                    borderRadius: "8px",
                    background: supportView === view ? colors.textPrimary : "#ffffff",
                    color: supportView === view ? "#ffffff" : colors.textPrimary,
                    fontWeight: 600,
                  }}
                >
                  {getAdminSupportViewLabel(view)}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <AdminSupportFeature
        active={tab === "support"}
        view={supportView}
        diagnosticFilters={diagnosticFilters}
        fetchAdmin={fetchAdmin}
        onNavigate={navigateAdmin}
      />

      <AdminSessionMonitoringFeature
        active={tab === "support" && supportView === "monitoring"}
        fetchAdmin={fetchAdmin}
        onNavigate={navigateAdmin}
        focusedExamId={focusedExamId}
        focusedCohortSessionId={focusedCohortSessionId}
        hasFocusedCohortSession={focusedCohortSession !== null}
        onEnsureCohortSessions={(examId) => {
          if (!cohortSessionCacheRef.current[examId]) void loadCohortExamSessions(examId);
        }}
        renderFocusedCohort={({ detail, lastCheckedAt, onRefresh }) =>
          focusedExam && focusedCohortSession ? (
            <CohortSessionWorkspacePanel
              mode="monitoring"
              examTitle={focusedExam.title}
              session={focusedCohortSession}
              detail={detail}
              loading={loading}
              lastCheckedAt={lastCheckedAt}
              onRefresh={onRefresh}
              onBack={() => navigateAdmin({ tab: "support", supportView: "monitoring" })}
              onPublish={() => undefined}
              getNavigationHref={getNavigationHref}
              onNavigate={navigateAdmin}
            />
          ) : undefined
        }
        cohortContent={
          <CohortSessionMonitoringList
            sessions={monitoredCohortSessions}
            onOpen={(examId, cohortSessionId) =>
              navigateAdmin({ tab: "support", supportView: "monitoring", examId, cohortSessionId })
            }
          />
        }
      />

    </main>
  );
}

