"use client";

import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  ADMIN_SESSION_EXPIRED_MESSAGE,
  type AdminTab,
  type AdminExamView,
  type AdminSupportView,
  beginLatestOnlyRequest,
  buildAdminConsoleHref,
  buildCorrelationDiagnosticsNavigation,
  buildMonitoringHistoryQueryString,
  buildExamAttemptDiagnosticsNavigation,
  buildDiagnosticLogQueryString,
  buildWebhookCallbackUrl,
  type DiagnosticLogFilters,
  getAdminTabLabel,
  getAdminSupportViewLabel,
  getAllowedRegionValidationMessage,
  getCompatibleRegions,
  getDefaultOpenPeriodMinutes,
  getExamAuthoringMode,
  getResetOpenPeriodMinutes,
  isAdminSessionExpiredStatus,
  isLatestOnlyResponse,
  mergeMonitoringHistoryPage,
  normaliseDiagnosticLogFilters,
  reconcileAllowedRegionIds,
  shouldClearAdminBannerOnTabChange,
  shouldShowCandidateProvisioning,
  shouldReconcileAllowedRegionIds,
} from "./admin-console-state";
import {
  DiagnosticLogTable,
  type DiagnosticLogTableEntry as DiagnosticLogEntry,
} from "./diagnostic-log-table";
import { SessionMonitoringPanel } from "./session-monitoring-panel";
import type { AdminMonitoringView as MonitoringView } from "@/domain/admin-monitoring";
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

interface AdminConsoleProps {
  readonly email: string;
  readonly initialTab?: AdminTab;
  readonly initialExamView?: AdminExamView;
  readonly initialExamId?: string;
  readonly initialCohortSessionId?: string;
  readonly initialSupportView?: AdminSupportView;
  readonly initialDiagnosticFilters?: DiagnosticLogFilters;
}

interface ConnectionState {
  hasConnection: boolean;
  connectedAt: string | null;
  verifiedAt: string | null;
  webhookPath: string | null;
}

interface AuditRecord {
  id: string;
  customerId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  action: string;
  outcome: "success" | "failure" | "denied";
  candidateId?: string | null;
  candidateEmail?: string | null;
  examId?: string | null;
  examAttemptId?: string | null;
  correlationId?: string | null;
  details?: Record<string, unknown> | null;
  error?: string | null;
  occurredAt: string;
}

interface AuditTrailFilters {
  readonly examAttemptId: string;
  readonly action: string;
  readonly outcome: string;
  readonly actorEmail: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly examId: string;
}

const EMPTY_AUDIT_FILTERS: AuditTrailFilters = {
  examAttemptId: "",
  action: "",
  outcome: "",
  actorEmail: "",
  subjectType: "",
  subjectId: "",
  examId: "",
};

interface DiagnosticLogPageResponse {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface ConnectionDiagnostic {
  operation: string;
  integrationSurface: string;
  integrationLabel?: string;
  method: string;
  path: string;
  requestUrl?: string;
  failureMode: string;
  responseStatus?: number;
  requestHeaders?: Record<string, unknown>;
  requestBody?: unknown;
  responseHeaders?: Record<string, unknown>;
  responseBody?: unknown;
  cause?: string;
  network?: Record<string, unknown>;
  tls?: Record<string, unknown>;
}

interface NamedResource {
  id: string;
  name: string;
  friendlyName?: string;
  description?: string;
  runtimeLeaseMinutes?: number | null;
  storageLeaseMinutes?: number | null;
}

interface BlueprintSnapshot {
  id: string;
  name: string;
  isDefault: boolean;
  regionIds: string[];
}

interface BlueprintDetail {
  id: string;
  name: string;
  description: string;
  defaultSnapshotId: string | null;
  snapshots: BlueprintSnapshot[];
}

interface ExamRecord {
  id: string;
  title: string;
  description: string;
  timeLimitMinutes: number;
  storageLeaseMinutes?: number | null;
  openPeriodMinutes: number;
  scoreRetrievalEnabled: boolean;
  deliveryAvailability?: "individual" | "cohort" | "both";
  status: "draft" | "published";
  publishedAt: string | null;
  createdAt?: string;
  projectId: string;
  projectName: string;
  blueprintId: string;
  blueprintName: string;
  snapshotId: string;
  snapshotName: string;
  allowedRegions: Array<{ id: string; name: string }>;
  policyId: string;
  policyName: string;
  instructorName: string;
}

interface CohortExamSessionRecord {
  session: {
    id: string;
    name: string;
    admissionStartsAt: string;
    admissionEndsAt: string | null;
    capacity: number | null;
    status: "draft" | "publishing" | "published" | "publish_reconciliation_required";
    cloudShareTrainingId?: string | null;
    cloudShareExperienceId?: string | null;
    cloudShareTeamId?: string | null;
    publishedAt?: string | null;
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

interface AdminCandidateScoreEvidence {
  scoreAvailable: boolean;
  percentComplete?: number;
  stepsCompleted?: number;
  stepsTotal?: number;
  passedRate?: number;
  failedRate?: number;
  retrievedAt: string;
}

interface AdminCandidateAttemptSummary {
  scheduled: number;
  ready: number;
  inProgress: number;
  suspended: number;
  completed: number;
  expired: number;
  total: number;
}

interface AdminCandidateAttempt {
  id: string;
  examId: string;
  examTitle: string;
  status: "scheduled" | "ready" | "in_progress" | "suspended" | "completed" | "expired";
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  scoreRetrievalEnabled: boolean;
  score: AdminCandidateScoreEvidence | null;
}

interface AdminCandidateRosterItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  createdAt: string;
  attemptSummary: AdminCandidateAttemptSummary;
  latestAttempt: AdminCandidateAttempt | null;
  latestScore: AdminCandidateScoreEvidence | null;
}

interface AdminCandidateDetail extends AdminCandidateRosterItem {
  attempts: AdminCandidateAttempt[];
}

function formatUtcTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function stripHtmlToText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCandidateScore(score: AdminCandidateScoreEvidence | null): string {
  if (!score) {
    return "No score evidence";
  }
  if (!score.scoreAvailable) {
    return "No score available";
  }

  if (typeof score.passedRate === "number" || typeof score.failedRate === "number") {
    const rates = [
      typeof score.passedRate === "number" ? `${Math.round(score.passedRate * 100)}% passed` : null,
      typeof score.failedRate === "number" ? `${Math.round(score.failedRate * 100)}% failed` : null,
    ].filter((value): value is string => value !== null);
    const steps =
      typeof score.stepsCompleted === "number" && typeof score.stepsTotal === "number"
        ? ` (${score.stepsCompleted}/${score.stepsTotal} steps)`
        : "";
    return `${rates.join(", ")}${steps}`;
  }

  const percent =
    typeof score.percentComplete === "number" ? `${score.percentComplete}%` : "Progress recorded";
  const steps =
    typeof score.stepsCompleted === "number" && typeof score.stepsTotal === "number"
      ? ` (${score.stepsCompleted}/${score.stepsTotal} steps)`
      : "";
  return `${percent}${steps}`;
}

function formatCandidateAttemptStatus(status: AdminCandidateAttempt["status"]): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "ready":
      return "Ready";
    case "in_progress":
      return "In progress";
    case "suspended":
      return "Suspended";
    case "completed":
      return "Completed";
    case "expired":
      return "Expired";
  }
}

function formatAttemptSummary(summary: AdminCandidateAttemptSummary): string {
  if (summary.total === 0) {
    return "No attempts";
  }

  return [
    `${summary.total} total`,
    summary.scheduled ? `${summary.scheduled} scheduled` : null,
    summary.ready ? `${summary.ready} ready` : null,
    summary.inProgress ? `${summary.inProgress} in progress` : null,
    summary.suspended ? `${summary.suspended} suspended` : null,
    summary.completed ? `${summary.completed} completed` : null,
    summary.expired ? `${summary.expired} expired` : null,
  ]
    .filter((item): item is string => item !== null)
    .join(" | ");
}

class AdminSessionExpiredError extends Error {
  constructor() {
    super(ADMIN_SESSION_EXPIRED_MESSAGE);
    this.name = "AdminSessionExpiredError";
  }
}

const DIAGNOSTIC_PAGE_LIMIT = 50;

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

const examCatalogOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "grid",
  alignItems: "flex-start",
  justifyItems: "center",
  minHeight: "18rem",
  padding: "1rem",
  boxSizing: "border-box",
  borderRadius: "8px",
  background: "rgba(248, 250, 252, 0.82)",
  backdropFilter: "blur(1px)",
};

const examCatalogOverlayPanelStyle: React.CSSProperties = {
  ...cardStyle,
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  flexWrap: "wrap",
  maxWidth: "min(100%, 22rem)",
  padding: "0.85rem 1rem",
  color: colors.textPrimary,
};

const examCatalogSpinnerStyle: React.CSSProperties = {
  width: "1.15rem",
  height: "1.15rem",
  borderRadius: "999px",
  border: `3px solid ${colors.borderStrong}`,
  borderTopColor: colors.accent,
  animation: "portal-spin 800ms linear infinite",
};

export function ExamCatalogLoadingOverlay() {
  return (
    <div style={examCatalogOverlayStyle} aria-live="polite" aria-busy="true">
      <div role="status" style={examCatalogOverlayPanelStyle}>
        <span className="portal-spinner" aria-hidden="true" style={examCatalogSpinnerStyle} />
        <span>Loading Exam Catalog resources</span>
      </div>
    </div>
  );
}

function getLogoutButtonStyle(disabled: boolean): React.CSSProperties {
  return disabled
    ? {
        ...accountLogoutButtonStyle,
        ...disabledButtonStyle,
      }
    : accountLogoutButtonStyle;
}

function isAdminSessionExpiredError(error: unknown): error is AdminSessionExpiredError {
  return error instanceof AdminSessionExpiredError;
}

function formatExamDeliveryAvailability(value: ExamRecord["deliveryAvailability"]): string {
  if (value === "cohort") return "Cohort Exam";
  if (value === "both") return "Individual + Cohort Exam";
  return "Individual Exam";
}

export function getDeliveryAvailabilityAuthoringOptions(value: ExamRecord["deliveryAvailability"]) {
  return [
    { value: "individual", label: "Individual Exam", disabled: false },
    { value: "cohort", label: "Cohort Exam", disabled: false },
    { value: "both", label: "Individual + Cohort Exam", disabled: false },
  ];
}

export const COHORT_SESSION_DRAFT_ONLY_COPY =
  "Candidate admission remains disabled in this slice. Published Cohort Exam Sessions stay admin-only until a later slice enables candidate joins.";

function formatCohortSessionStatus(status: CohortExamSessionRecord["session"]["status"]): string {
  switch (status) {
    case "publish_reconciliation_required":
      return "Publish reconciliation required";
    case "publishing":
      return "Publishing";
    case "published":
      return "Published";
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
    case "publishing":
      return "info";
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
  gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
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

function CohortSessionDetailItem(props: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div style={cohortSessionDetailItemStyle}>
      <div style={cohortSessionDetailLabelStyle}>{props.label}</div>
      <div>{props.value}</div>
    </div>
  );
}

export function formatShortExamId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function getDuplicateExamResourceTupleWarning(input: {
  readonly exams: readonly ExamRecord[];
  readonly currentExamId?: string | null;
  readonly projectId: string;
  readonly blueprintId: string;
  readonly snapshotId: string | null;
  readonly policyId: string;
  readonly deliveryAvailability: ExamRecord["deliveryAvailability"];
}): string | null {
  const snapshotId = input.snapshotId ?? "";
  if (!input.projectId || !input.blueprintId || !snapshotId || !input.policyId) {
    return null;
  }

  const duplicate = input.exams.find(
    (exam) =>
      exam.id !== input.currentExamId &&
      exam.projectId === input.projectId &&
      exam.blueprintId === input.blueprintId &&
      exam.snapshotId === snapshotId &&
      exam.policyId === input.policyId &&
      (exam.deliveryAvailability ?? "individual") === input.deliveryAvailability,
  );

  if (!duplicate) {
    return null;
  }

  return `Another Exam already uses this Project, Blueprint, default Snapshot, Policy, and delivery mode: ${duplicate.title} (${formatShortExamId(
    duplicate.id,
  )}). Confirm the Exam title and delivery scope before saving.`;
}

export function isCohortSessionAuthoringAvailable(
  value: ExamRecord["deliveryAvailability"],
): boolean {
  return value === "cohort" || value === "both";
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
        {props.sessions.length === 0 ? (
          <span style={{ color: "#666" }}>No draft Cohort Exam Sessions yet.</span>
        ) : (
          <div style={cohortSessionTileGridStyle}>
            {props.sessions.map((session) => (
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
                  {session.session.cloudShareExperienceId ? (
                    <CohortSessionDetailItem
                      label="CloudShare Experience ID"
                      value={session.session.cloudShareExperienceId}
                    />
                  ) : session.session.cloudShareTrainingId ? (
                    <CohortSessionDetailItem
                      label="CloudShare training ID"
                      value={session.session.cloudShareTrainingId}
                    />
                  ) : null}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => props.onSelect(session)} style={compactButtonStyle}>
                    Open Session
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
  loading: boolean;
  onBack: () => void;
  onPublish: () => void;
}) {
  const { session } = props;

  return (
    <div style={{ ...cardStyle, display: "grid", gap: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <h3 style={{ margin: 0 }}>Cohort Exam Session workspace</h3>
          <p style={{ margin: 0, color: colors.textSecondary }}>{props.examTitle}</p>
          <CohortSessionDraftOnlyNotice />
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

        {session.session.status === "draft" ? (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <button type="button" onClick={props.onPublish} disabled={props.loading} style={primaryButtonStyle}>
              Publish Cohort Session
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
          {session.session.cloudShareTrainingId ? (
            <CohortSessionDetailItem
              label="CloudShare training ID"
              value={session.session.cloudShareTrainingId}
            />
          ) : null}
          {session.session.cloudShareExperienceId ? (
            <CohortSessionDetailItem
              label="CloudShare Experience ID"
              value={session.session.cloudShareExperienceId}
            />
          ) : null}
          {session.session.cloudShareTeamId ? (
            <CohortSessionDetailItem label="CloudShare Team ID" value={session.session.cloudShareTeamId} />
          ) : null}
          {session.session.publishedAt ? (
            <CohortSessionDetailItem
              label="Published at"
              value={formatCohortSessionDateTime(session.session.publishedAt)}
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
              <span>Correlation ID: {session.session.lastPublishCorrelationId}</span>
            ) : null}
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
      </div>
    </div>
  );
}

function SelectionSummaryRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>
      {props.label}: {props.value}
    </div>
  );
}

export function ExamAuthoringSelectionSummary(props: {
  readonly selectedProject: NamedResource | null;
  readonly selectedBlueprint: NamedResource | null;
  readonly defaultSnapshot: BlueprintSnapshot | null;
  readonly selectedAllowedRegions: readonly NamedResource[];
  readonly selectedPolicy: NamedResource | null;
  readonly deliveryAvailability: ExamRecord["deliveryAvailability"];
  readonly duplicateExamResourceTupleWarning?: string | null;
}) {
  const policySummary = [
    props.selectedPolicy?.name ?? "-",
    props.selectedPolicy?.runtimeLeaseMinutes
      ? `${props.selectedPolicy.runtimeLeaseMinutes} minute runtime lease`
      : null,
    props.selectedPolicy?.storageLeaseMinutes
      ? `${props.selectedPolicy.storageLeaseMinutes} minute storage retention`
      : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        display: "grid",
        gap: "0.5rem",
        padding: "0.85rem 1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "6px",
        background: "#fafafa",
      }}
    >
      <strong>Selection summary</strong>
      <SelectionSummaryRow label="Project" value={props.selectedProject?.name ?? "-"} />
      <SelectionSummaryRow label="Blueprint" value={props.selectedBlueprint?.name ?? "-"} />
      <SelectionSummaryRow
        label="Snapshot"
        value={
          props.defaultSnapshot
            ? `${props.defaultSnapshot.name} (default only for Experience launches)`
            : "-"
        }
      />
      <SelectionSummaryRow
        label="Allowed Regions"
        value={
          props.selectedAllowedRegions.length > 0
            ? props.selectedAllowedRegions.map((region) => region.friendlyName ?? region.name).join(", ")
            : "-"
        }
      />
      <SelectionSummaryRow label="Policy" value={policySummary} />
      <SelectionSummaryRow
        label="Delivery"
        value={formatExamDeliveryAvailability(props.deliveryAvailability)}
      />
      {props.duplicateExamResourceTupleWarning && (
        <div
          role="status"
          style={{
            color: "#7a4b00",
            background: "#fff7e6",
            border: "1px solid #f0d38a",
            borderRadius: "6px",
            padding: "0.7rem 0.85rem",
          }}
        >
          {props.duplicateExamResourceTupleWarning}
        </div>
      )}
    </div>
  );
}

export function ExamCatalogRowActions(props: {
  readonly exam: Pick<ExamRecord, "id" | "status" | "deliveryAvailability">;
  readonly loading: boolean;
  readonly editingExamId: string | null;
  readonly onEdit: () => void;
  readonly onPublish: () => void;
  readonly onUnpublish: () => void;
  readonly onManageCohortSessions: () => void;
}) {
  const supportsCohortSessions = isCohortSessionAuthoringAvailable(props.exam.deliveryAvailability);
  const isCohortOnly = props.exam.deliveryAvailability === "cohort";

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ color: colors.textSecondary, fontSize: "0.8rem" }}>
        Delivery: {formatExamDeliveryAvailability(props.exam.deliveryAvailability)}
      </div>
      {supportsCohortSessions ? (
        <button
          type="button"
          onClick={props.onManageCohortSessions}
          disabled={props.loading}
          style={{ padding: "0.45rem 0.75rem" }}
        >
          Manage Cohort Sessions
        </button>
      ) : null}
      {isCohortOnly ? (
        <div style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
          <div>Exam setup is {props.exam.status}</div>
          <div>Publish the individual Cohort Sessions after opening this Exam.</div>
        </div>
      ) : props.exam.status === "draft" ? (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {props.editingExamId === props.exam.id ? (
            <span style={{ color: colors.textSecondary, fontSize: "0.85rem" }}>
              Editing - save or cancel before publishing.
            </span>
          ) : (
            <>
              <button
                onClick={props.onEdit}
                disabled={props.loading || props.editingExamId !== null}
                style={{ padding: "0.45rem 0.75rem" }}
              >
                Edit Exam
              </button>
              <button
                onClick={props.onPublish}
                disabled={props.loading || props.editingExamId !== null}
                style={{ padding: "0.45rem 0.75rem" }}
              >
                Publish Exam
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={props.onUnpublish}
          disabled={props.loading || props.editingExamId !== null}
          style={{ padding: "0.45rem 0.75rem" }}
        >
          Unpublish Exam
        </button>
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

function ExamWorkspaceBreadcrumbs(props: {
  readonly examView: AdminExamView;
  readonly focusedExamTitle: string | null;
  readonly onNavigateToCatalog: () => void;
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

export function AdminCandidateRosterPanel({
  candidates,
  selectedCandidate,
  loading,
  onOpenCandidate,
}: {
  readonly candidates: readonly AdminCandidateRosterItem[] | null;
  readonly selectedCandidate: AdminCandidateDetail | null;
  readonly loading: boolean;
  readonly onOpenCandidate: (candidateId: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div>
        <h2 style={{ margin: "0 0 0.35rem" }}>Candidate roster</h2>
      </div>

      {candidates === null ? (
        <p style={{ color: "#555" }}>
          {loading ? "Loading candidates..." : "No roster loaded."}
        </p>
      ) : candidates.length === 0 ? (
        <div style={{ padding: "0.85rem", border: "1px solid #e5e7eb", borderRadius: "6px" }}>
          No candidates found.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                {["Candidate", "Attempts", "Latest attempt", "Latest score", "Action"].map((heading) => (
                  <th
                    key={heading}
                    style={{ textAlign: "left", padding: "0.55rem", borderBottom: "1px solid #ddd" }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <div style={{ fontWeight: 700 }}>{candidate.name}</div>
                    <div style={{ color: "#555" }}>{candidate.email}</div>
                    <div style={{ color: "#666", fontSize: "0.78rem" }}>
                      Created {formatUtcTimestamp(candidate.createdAt)}
                    </div>
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    {formatAttemptSummary(candidate.attemptSummary)}
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    {candidate.latestAttempt ? (
                      <>
                        <div>{candidate.latestAttempt.examTitle}</div>
                        <div style={{ color: "#555" }}>
                          {formatCandidateAttemptStatus(candidate.latestAttempt.status)}
                        </div>
                        <div style={{ color: "#666", fontSize: "0.78rem" }}>
                          {formatUtcTimestamp(candidate.latestAttempt.scheduledFor)}
                        </div>
                      </>
                    ) : (
                      "No attempts"
                    )}
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <div>{formatCandidateScore(candidate.latestScore)}</div>
                    {candidate.latestScore ? (
                      <div style={{ color: "#666", fontSize: "0.78rem" }}>
                        Retrieved {formatUtcTimestamp(candidate.latestScore.retrievedAt)}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <button
                      type="button"
                      onClick={() => onOpenCandidate(candidate.id)}
                      disabled={loading}
                      style={{ padding: "0.4rem 0.75rem" }}
                    >
                      View History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedCandidate ? (
        <section
          aria-label="Candidate exam history"
          style={{
            border: "1px solid #d9e2ef",
            borderRadius: "6px",
            padding: "1rem",
            background: "#f8fafc",
          }}
        >
          <div style={{ marginBottom: "0.75rem" }}>
            <h3 style={{ margin: "0 0 0.25rem" }}>{selectedCandidate.name}</h3>
            <div style={{ color: "#555" }}>{selectedCandidate.email}</div>
          </div>
          {selectedCandidate.attempts.length === 0 ? (
            <p style={{ margin: 0, color: "#555" }}>This candidate has no ExamAttempts yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                <thead>
                  <tr style={{ background: "#fff" }}>
                    {["Exam", "Status", "Scheduled", "Completed", "Score"].map((heading) => (
                      <th
                        key={heading}
                        style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #d7dce4" }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selectedCandidate.attempts.map((attempt) => (
                    <tr key={attempt.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                        <div>{attempt.examTitle}</div>
                        <div style={{ color: "#666", fontSize: "0.78rem", fontFamily: "monospace" }}>
                          {attempt.id}
                        </div>
                      </td>
                      <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                        {formatCandidateAttemptStatus(attempt.status)}
                      </td>
                      <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                        {formatUtcTimestamp(attempt.scheduledFor)}
                      </td>
                      <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                        {formatUtcTimestamp(attempt.completedAt)}
                      </td>
                      <td style={{ padding: "0.5rem", verticalAlign: "top" }}>
                        <div>{formatCandidateScore(attempt.score)}</div>
                        {attempt.scoreRetrievalEnabled && !attempt.score ? (
                          <div style={{ color: "#666", fontSize: "0.78rem" }}>
                            Score retrieval enabled, no persisted score yet.
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
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
  const [projects, setProjects] = useState<NamedResource[]>([]);
  const [regions, setRegions] = useState<NamedResource[]>([]);
  const [blueprints, setBlueprints] = useState<NamedResource[]>([]);
  const [policies, setPolicies] = useState<NamedResource[]>([]);
  const [blueprintDetail, setBlueprintDetail] = useState<BlueprintDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedBlueprintId, setSelectedBlueprintId] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [selectedAllowedRegionIds, setSelectedAllowedRegionIds] = useState<string[]>([]);
  const [examTitle, setExamTitle] = useState("");
  const [examDescription, setExamDescription] = useState("");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState("90");
  const [openPeriodMinutes, setOpenPeriodMinutes] = useState("90");
  const [scoreRetrievalEnabled, setScoreRetrievalEnabled] = useState(false);
  const [deliveryAvailability, setDeliveryAvailability] = useState<"individual" | "cohort" | "both">("individual");
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examCatalog, setExamCatalog] = useState<ExamRecord[]>([]);
  const [cohortSessionsByExamId, setCohortSessionsByExamId] = useState<Record<string, CohortExamSessionRecord[]>>({});
  const [cohortSessionFormsByExamId, setCohortSessionFormsByExamId] = useState<Record<string, CohortExamSessionFormState>>({});
  const [selectedCohortSession, setSelectedCohortSession] = useState<CohortExamSessionRecord | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringView | null>(null);
  const [examMessage, setExamMessage] = useState<string | null>(null);
  const [examFormFeedback, setExamFormFeedback] = useState<string | null>(null);
  const [examDiagnostic, setExamDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [examCorrelationId, setExamCorrelationId] = useState<string | null>(null);
  const projectResourcesRequestIdRef = useRef(0);
  const blueprintDetailRequestIdRef = useRef(0);
  const examCatalogLoadingCountRef = useRef(0);
  const [auditFilters, setAuditFilters] = useState<AuditTrailFilters>(EMPTY_AUDIT_FILTERS);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[] | null>(null);
  const [diagnosticEntries, setDiagnosticEntries] = useState<DiagnosticLogEntry[] | null>(null);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(initialDiagnosticFilters);
  const [diagnosticPage, setDiagnosticPage] = useState<DiagnosticLogPageResponse | null>(null);
  const [expandedDiagnosticId, setExpandedDiagnosticId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [apiId, setApiId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookPublicBaseUrl, setWebhookPublicBaseUrl] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connectionDiagnostic, setConnectionDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [connectionCorrelationId, setConnectionCorrelationId] = useState<string | null>(null);
  const [connectionOccurredAt, setConnectionOccurredAt] = useState<string | null>(null);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  const [candidateFirstName, setCandidateFirstName] = useState("");
  const [candidateLastName, setCandidateLastName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePassword, setCandidatePassword] = useState("");
  const [candidateMessage, setCandidateMessage] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidateRoster, setCandidateRoster] = useState<AdminCandidateRosterItem[] | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<AdminCandidateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [examCatalogLoading, setExamCatalogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    void loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "exams") {
      void loadExamCatalog();
      if (examView === "create" || examView === "edit") {
        void loadExamAuthoring();
      }
    }
    if (tab === "support" && supportView === "monitoring") {
      void loadMonitoring();
    }
    if (tab === "candidates") {
      void loadCandidates();
    }
    if (tab === "support" && supportView === "diagnostics") {
      void loadDiagnostics();
    }
    if (tab === "support" && supportView === "audit") {
      void loadAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, examView, supportView]);

  useEffect(() => {
    if (tab !== "exams" || examView !== "edit" || !focusedExamId || editingExamId === focusedExamId) {
      return;
    }
    const exam = examCatalog.find((item) => item.id === focusedExamId);
    if (exam) {
      void beginEditingExam(exam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, examView, focusedExamId, examCatalog, editingExamId]);

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
    setConnectionCorrelationId(null);
    setExamCorrelationId(null);
    setConnectionDiagnostic(null);
    setExamDiagnostic(null);
    router.replace("/login");
    router.refresh();
  }, [router]);

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

  function navigateAdmin(next: {
    tab: AdminTab;
    examView?: AdminExamView;
    examId?: string | null;
    cohortSessionId?: string | null;
    supportView?: AdminSupportView;
    diagnosticFilters?: DiagnosticLogFilters;
  }) {
    const nextDiagnosticFilters = next.diagnosticFilters ?? diagnosticFilters;
    const nextExamView = next.examView ?? "catalog";
    const nextSupportView = next.supportView ?? "monitoring";
    router.push(
      buildAdminConsoleHref({
        tab: next.tab,
        examView: nextExamView,
        examId: next.examId ?? undefined,
        cohortSessionId: next.cohortSessionId ?? undefined,
        supportView: nextSupportView,
        diagnosticFilters: nextDiagnosticFilters,
      }),
    );
    setTab(next.tab);
    setExamView(nextExamView);
    setFocusedExamId(next.examId ?? null);
    setFocusedCohortSessionId(next.cohortSessionId ?? null);
    setSupportView(nextSupportView);
    setDiagnosticFilters(nextDiagnosticFilters);
  }

  function navigateToExamCatalog() {
    setEditingExamId(null);
    setSelectedCohortSession(null);
    navigateAdmin({ tab: "exams", examView: "catalog" });
  }

  function navigateToExamCreate() {
    resetExamForm();
    navigateAdmin({ tab: "exams", examView: "create" });
    void loadExamAuthoring();
  }

  function navigateToExamSessions(examId: string) {
    setSelectedCohortSession(null);
    navigateAdmin({ tab: "exams", examView: "sessions", examId });
    void loadCohortExamSessions(examId);
  }

  async function fetchAdmin(input: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(input, init);
    if (isAdminSessionExpiredStatus(response.status)) {
      handleAdminSessionExpired();
      throw new AdminSessionExpiredError();
    }
    return response;
  }

  async function loadConnection() {
    try {
      const response = await fetchAdmin("/api/admin/cloudshare");
      const data = (await response.json()) as ConnectionState & { error?: string };
      if (response.ok) {
        setConnection({
          hasConnection: data.hasConnection,
          connectedAt: data.connectedAt,
          verifiedAt: data.verifiedAt,
          webhookPath: data.webhookPath,
        });
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
    }
  }

  async function saveConnection() {
    setLoading(true);
    setError(null);
    setConnectionMessage(null);
    setConnectionDiagnostic(null);
    setConnectionCorrelationId(null);
    setConnectionOccurredAt(null);
    setConnectionWarning(null);
    const trimmedApiId = apiId.trim();
    const trimmedApiKey = apiKey.trim();
    const trimmedWebhookSecret = webhookSecret.trim();
    if (!hasSavedConnection && (!trimmedApiId || !trimmedApiKey || !trimmedWebhookSecret)) {
      setError("API ID, API Key, and Webhook Secret are required to save the first CloudShare Connection.");
      setLoading(false);
      return;
    }
    if (hasSavedConnection && !trimmedApiId && !trimmedApiKey && !trimmedWebhookSecret) {
      setError("Enter at least one field to update the saved CloudShare Connection.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetchAdmin("/api/admin/cloudshare", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiId: trimmedApiId,
          apiKey: trimmedApiKey,
          webhookSecret: trimmedWebhookSecret,
        }),
      });
      const data = (await response.json()) as ConnectionState & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to save CloudShare Connection");
        return;
      }
      setConnection({
        hasConnection: data.hasConnection,
        connectedAt: data.connectedAt,
        verifiedAt: data.verifiedAt,
        webhookPath: data.webhookPath,
      });
      setConnectionMessage("CloudShare Connection saved.");
      setApiId("");
      setApiKey("");
      setWebhookSecret("");
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to save CloudShare Connection");
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    setLoading(true);
    setError(null);
    setConnectionMessage(null);
    setConnectionDiagnostic(null);
    setConnectionCorrelationId(null);
    setConnectionOccurredAt(null);
    setConnectionWarning(null);
    try {
      const response = await fetchAdmin("/api/admin/cloudshare/test", { method: "POST" });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        verifiedAt?: string;
        correlationId?: string;
        occurredAt?: string;
        diagnostic?: ConnectionDiagnostic | null;
      };
      if (!response.ok) {
        setError(data.error ?? "CloudShare connection test failed");
        setConnectionWarning("CloudShare connection test failed. Open Support Diagnostics with the correlation ID for the primary investigation view.");
        setConnectionDiagnostic(data.diagnostic ?? null);
        setConnectionCorrelationId(data.correlationId ?? null);
        setConnectionOccurredAt(data.occurredAt ?? null);
        return;
      }
      await loadConnection();
      setConnectionMessage(`CloudShare responded with ${data.message}.`);
      setConnectionCorrelationId(data.correlationId ?? null);
      setConnectionOccurredAt(data.occurredAt ?? null);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("CloudShare connection test failed");
      setConnectionWarning("CloudShare connection test failed. Open Support Diagnostics for more detail.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit(filters: AuditTrailFilters = auditFilters) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        const trimmed = value.trim();
        if (trimmed) {
          params.set(key, trimmed);
        }
      }
      const query = params.toString();
      const qs = query ? `?${query}` : "";
      const res = await fetchAdmin(`/api/admin/audit${qs}`);
      const data = await res.json() as { records?: AuditRecord[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load audit trail");
        return;
      }
      setAuditRecords(data.records ?? []);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }

  function setAuditFilter<K extends keyof AuditTrailFilters>(
    key: K,
    value: AuditTrailFilters[K],
  ) {
    setAuditFilters((current) => ({ ...current, [key]: value }));
  }

  function applyAuditFilters() {
    void loadAudit();
  }

  function clearAuditFilters() {
    setAuditFilters(EMPTY_AUDIT_FILTERS);
    void loadAudit(EMPTY_AUDIT_FILTERS);
  }

  async function loadMonitoring(historyOffset = 0) {
    setLoading(true);
    setError(null);
    try {
      const query = buildMonitoringHistoryQueryString({ limit: 25, offset: historyOffset });
      const res = await fetchAdmin(`/api/admin/monitoring${query}`);
      const data = (await res.json()) as { monitoring?: MonitoringView; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load session monitoring");
        return;
      }
      setMonitoring((current) =>
        data.monitoring ? mergeMonitoringHistoryPage(historyOffset === 0 ? null : current, data.monitoring) : null,
      );
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load session monitoring");
    } finally {
      setLoading(false);
    }
  }

  function openExamAttemptSupportDiagnostics(examAttemptId: string) {
    const navigation = buildExamAttemptDiagnosticsNavigation(examAttemptId);
    navigateAdmin({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: navigation.filters,
    });
    setExpandedDiagnosticId(null);
    if (tab === "support" && supportView === "diagnostics") {
      void loadDiagnostics(false, navigation.pageOffset, navigation.filters);
    }
  }

  function openCorrelationSupportDiagnostics(correlationId: string) {
    const navigation = buildCorrelationDiagnosticsNavigation(correlationId);
    navigateAdmin({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: navigation.filters,
    });
    setExpandedDiagnosticId(null);
    if (tab === "support" && supportView === "diagnostics") {
      void loadDiagnostics(false, navigation.pageOffset, navigation.filters);
    }
  }

  function loadMoreMonitoringHistory() {
    const nextOffset = monitoring?.historyPage.nextOffset;
    if (typeof nextOffset !== "number") {
      return;
    }

    void loadMonitoring(nextOffset);
  }

  async function loadDiagnostics(
    background = false,
    offset = 0,
    filters: DiagnosticLogFilters = diagnosticFilters,
  ) {
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const query = buildDiagnosticLogQueryString(
        normaliseDiagnosticLogFilters(filters),
        { limit: DIAGNOSTIC_PAGE_LIMIT, offset },
      );
      const res = await fetchAdmin(`/api/admin/diagnostics${query}`);
      const data = (await res.json()) as {
        entries?: DiagnosticLogEntry[];
        page?: DiagnosticLogPageResponse;
        error?: string;
      };
      if (!res.ok) {
        if (!background) {
          setError(data.error ?? "Failed to load diagnostic log");
        }
        return;
      }
      setDiagnosticEntries(data.entries ?? []);
      setDiagnosticPage(
        data.page ?? {
          limit: DIAGNOSTIC_PAGE_LIMIT,
          offset,
          returned: data.entries?.length ?? 0,
          hasMore: false,
          nextOffset: null,
        },
      );
      setExpandedDiagnosticId(null);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      if (!background) {
        setError("Failed to load diagnostic log");
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  async function loadCandidates(search = candidateSearch) {
    setLoading(true);
    setError(null);
    try {
      const trimmedSearch = search.trim();
      const query = trimmedSearch ? `?search=${encodeURIComponent(trimmedSearch)}` : "";
      const res = await fetchAdmin(`/api/admin/candidates${query}`);
      const data = (await res.json()) as {
        candidates?: AdminCandidateRosterItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load candidates");
        return;
      }
      setCandidateRoster(data.candidates ?? []);
      if (
        selectedCandidate &&
        !(data.candidates ?? []).some((candidate) => candidate.id === selectedCandidate.id)
      ) {
        setSelectedCandidate(null);
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }

  async function loadCandidateDetail(candidateId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmin(`/api/admin/candidates/${encodeURIComponent(candidateId)}`);
      const data = (await res.json()) as {
        candidate?: AdminCandidateDetail;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load candidate history");
        return;
      }
      setSelectedCandidate(data.candidate ?? null);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load candidate history");
    } finally {
      setLoading(false);
    }
  }

  function onLoadDiagnostics() {
    void loadDiagnostics(false, 0);
  }

  function setDiagnosticFilter<K extends keyof DiagnosticLogFilters>(
    key: K,
    value: DiagnosticLogFilters[K],
  ) {
    setDiagnosticFilters((current) => ({ ...current, [key]: value }));
  }

  function applyDiagnosticFilters() {
    navigateAdmin({ tab: "support", supportView: "diagnostics", diagnosticFilters });
    void loadDiagnostics(false, 0);
  }

  function clearDiagnosticFilters() {
    const clearedFilters: DiagnosticLogFilters = {};
    navigateAdmin({ tab: "support", supportView: "diagnostics", diagnosticFilters: clearedFilters });
    setDiagnosticPage(null);
    setExpandedDiagnosticId(null);
    void loadDiagnostics(false, 0, clearedFilters);
  }

  function loadPreviousDiagnosticPage() {
    const nextOffset = Math.max((diagnosticPage?.offset ?? 0) - DIAGNOSTIC_PAGE_LIMIT, 0);
    void loadDiagnostics(false, nextOffset);
  }

  function loadNextDiagnosticPage() {
    if (diagnosticPage?.nextOffset === null || diagnosticPage?.nextOffset === undefined) {
      return;
    }
    void loadDiagnostics(false, diagnosticPage.nextOffset);
  }

  function resetExamForm(next?: {
    title?: string;
    description?: string;
    scoreRetrievalEnabled?: boolean;
    deliveryAvailability?: "individual" | "cohort" | "both";
    timeLimitMinutes?: string;
    openPeriodMinutes?: string;
  }) {
    setEditingExamId(null);
    setExamMessage(null);
    setExamFormFeedback(null);
    setExamTitle(next?.title ?? blueprintDetail?.name ?? "");
    setExamDescription(next?.description ?? stripHtmlToText(blueprintDetail?.description) ?? "");
    setScoreRetrievalEnabled(next?.scoreRetrievalEnabled ?? false);
    setDeliveryAvailability(next?.deliveryAvailability ?? "individual");
    setTimeLimitMinutes(next?.timeLimitMinutes ?? "");
    setOpenPeriodMinutes(
      getResetOpenPeriodMinutes({
        explicitOpenPeriodMinutes: next?.openPeriodMinutes,
        selectedPolicy,
        fallbackRuntimeLeaseMinutes: timeLimitMinutes,
      }),
    );
  }

  async function loadExamAuthoring(refresh = false) {
    setLoading(true);
    beginExamCatalogLoading();
    setError(null);
    setExamDiagnostic(null);
    try {
      const response = await fetchAdmin(`/api/admin/exam-authoring${refresh ? "?refresh=true" : ""}`);
      const data = (await response.json()) as {
        projects?: NamedResource[];
        regions?: NamedResource[];
        error?: string;
        correlationId?: string | null;
        diagnostic?: ConnectionDiagnostic | null;
      };
      if (!response.ok) {
        setError(data.error ?? "Failed to load exam authoring resources");
        setExamCorrelationId(data.correlationId ?? null);
        setExamDiagnostic(data.diagnostic ?? null);
        return;
      }

      const nextProjects = data.projects ?? [];
      const nextRegions = data.regions ?? [];
      setProjects(nextProjects);
      setRegions(nextRegions);
      const nextProjectId = nextProjects.some((project) => project.id === selectedProjectId)
        ? selectedProjectId
        : (nextProjects[0]?.id ?? "");
      if (nextProjectId !== selectedProjectId) {
        setSelectedProjectId(nextProjectId);
      }
      if (!selectedProjectId && nextProjectId) {
        const projectId = nextProjectId;
        setSelectedProjectId(projectId);
        await loadProjectResources(projectId, true);
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load exam authoring resources");
    } finally {
      setLoading(false);
      endExamCatalogLoading();
    }
  }

  async function loadProjectResources(
    projectId: string,
    refresh = false,
    preferredBlueprintId?: string,
    preferredPolicyId?: string,
  ) {
    const requestId = beginLatestOnlyRequest(projectResourcesRequestIdRef.current);
    projectResourcesRequestIdRef.current = requestId;
    setLoading(true);
    beginExamCatalogLoading();
    setError(null);
    setExamDiagnostic(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exam-authoring/projects/${encodeURIComponent(projectId)}${refresh ? "?refresh=true" : ""}`,
      );
      const data = (await response.json()) as {
        blueprints?: NamedResource[];
        policies?: NamedResource[];
        error?: string;
        correlationId?: string | null;
        diagnostic?: ConnectionDiagnostic | null;
      };
      if (!response.ok) {
        if (!isLatestOnlyResponse(projectResourcesRequestIdRef.current, requestId)) {
          return;
        }
        setError(data.error ?? "Failed to load project resources");
        setExamCorrelationId(data.correlationId ?? null);
        setExamDiagnostic(data.diagnostic ?? null);
        return;
      }

      if (!isLatestOnlyResponse(projectResourcesRequestIdRef.current, requestId)) {
        return;
      }

      const nextBlueprints = data.blueprints ?? [];
      const nextPolicies = data.policies ?? [];
      const nextPolicy = setBluePrintState(nextBlueprints, nextPolicies, preferredPolicyId);
      const desiredBlueprintId = preferredBlueprintId ?? selectedBlueprintId;
      const nextBlueprintId = nextBlueprints.some((blueprint) => blueprint.id === desiredBlueprintId)
        ? desiredBlueprintId
        : (nextBlueprints[0]?.id ?? "");
      if (nextBlueprintId !== selectedBlueprintId) {
        setSelectedBlueprintId(nextBlueprintId);
      }
      if (nextBlueprintId) {
        const blueprintId = nextBlueprintId;
        setSelectedBlueprintId(blueprintId);
        await loadBlueprintDetail(projectId, blueprintId, refresh, nextPolicy);
      } else {
        setBlueprintDetail(null);
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      if (!isLatestOnlyResponse(projectResourcesRequestIdRef.current, requestId)) {
        return;
      }
      setError("Failed to load project resources");
    } finally {
      setLoading(false);
      endExamCatalogLoading();
    }
  }

  function setBluePrintState(
    nextBlueprints: NamedResource[],
    nextPolicies: NamedResource[],
    preferredPolicyId?: string,
  ): NamedResource | undefined {
    setBlueprints(nextBlueprints);
    setPolicies(nextPolicies);
    const desiredPolicyId = preferredPolicyId ?? selectedPolicyId;
    const nextPolicyId = nextPolicies.some((policy) => policy.id === desiredPolicyId)
      ? desiredPolicyId
      : (nextPolicies[0]?.id ?? "");
    setSelectedPolicyId(nextPolicyId);
    const selectedPolicy = nextPolicies.find((policy) => policy.id === nextPolicyId);
    if (selectedPolicy?.runtimeLeaseMinutes) {
      setTimeLimitMinutes(String(selectedPolicy.runtimeLeaseMinutes));
    }
    if (!editingExamId && examView !== "edit") {
      setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(selectedPolicy));
    }
    return selectedPolicy;
  }

  async function loadBlueprintDetail(
    projectId: string,
    blueprintId: string,
    refresh = false,
    policyForDefault: NamedResource | null | undefined = selectedPolicy,
  ) {
    const requestId = beginLatestOnlyRequest(blueprintDetailRequestIdRef.current);
    blueprintDetailRequestIdRef.current = requestId;
    setLoading(true);
    beginExamCatalogLoading();
    setError(null);
    setExamDiagnostic(null);
    try {
      const response = await fetchAdmin(
        `/api/admin/exam-authoring/projects/${encodeURIComponent(projectId)}/blueprints/${encodeURIComponent(blueprintId)}${refresh ? "?refresh=true" : ""}`,
      );
      const data = (await response.json()) as {
        blueprint?: BlueprintDetail;
        error?: string;
        correlationId?: string | null;
        diagnostic?: ConnectionDiagnostic | null;
      };
      if (!response.ok) {
        if (!isLatestOnlyResponse(blueprintDetailRequestIdRef.current, requestId)) {
          return;
        }
        setError(data.error ?? "Failed to load blueprint detail");
        setExamCorrelationId(data.correlationId ?? null);
        setExamDiagnostic(data.diagnostic ?? null);
        return;
      }

      if (!isLatestOnlyResponse(blueprintDetailRequestIdRef.current, requestId)) {
        return;
      }

      const detail = data.blueprint ?? null;
      setError(null);
      setExamCorrelationId(null);
      setExamDiagnostic(null);
      setBlueprintDetail(detail);
      if (!editingExamId && examView !== "edit" && detail) {
        setExamTitle(detail.name);
        setExamDescription(stripHtmlToText(detail.description));
        setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(policyForDefault));
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      if (!isLatestOnlyResponse(blueprintDetailRequestIdRef.current, requestId)) {
        return;
      }
      setError("Failed to load blueprint detail");
    } finally {
      setLoading(false);
      endExamCatalogLoading();
    }
  }

  async function loadExamCatalog() {
    beginExamCatalogLoading();
    try {
      const response = await fetchAdmin("/api/admin/exams");
      const data = (await response.json()) as { exams?: ExamRecord[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to load exam catalog");
        return;
      }
      const nextExams = data.exams ?? [];
      setExamCatalog(nextExams);
      await Promise.all(nextExams.map((exam) => loadCohortExamSessions(exam.id)));
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
    try {
      const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/cohort-sessions`);
      const data = (await response.json()) as { sessions?: CohortExamSessionRecord[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to load Cohort Exam Sessions");
        return;
      }
      setCohortSessionsByExamId((current) => ({
        ...current,
        [examId]: data.sessions ?? [],
      }));
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load Cohort Exam Sessions");
    }
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
        setError(
          data.correlationId
            ? `${data.error ?? "Failed to publish Cohort Exam Session"} Correlation ID: ${data.correlationId}`
            : data.error ?? "Failed to publish Cohort Exam Session",
        );
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

  async function saveDraftExam() {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    setExamFormFeedback(null);
    try {
      const project = projects.find((item) => item.id === selectedProjectId);
      const blueprint = blueprints.find((item) => item.id === selectedBlueprintId);
      const policy = policies.find((item) => item.id === selectedPolicyId);
      const snapshot = blueprintDetail?.snapshots.find(
        (item) => item.id === blueprintDetail.defaultSnapshotId,
      );
      const policyTimeLimitMinutes = policy?.runtimeLeaseMinutes ?? null;
      const parsedOpenPeriodMinutes = Number(openPeriodMinutes);
      const validationMessage = getAllowedRegionValidationMessage(
        selectedAllowedRegionIds,
        compatibleRegions,
      );

      if (validationMessage) {
        setError(validationMessage);
        setExamFormFeedback(validationMessage);
        return;
      }

      if (!project || !blueprint || !policy || !snapshot || !policyTimeLimitMinutes) {
        const message = "Select a project, blueprint, policy, and allowed Region set before saving the Exam.";
        setError(message);
        setExamFormFeedback(message);
        return;
      }
      if (!Number.isInteger(parsedOpenPeriodMinutes) || parsedOpenPeriodMinutes <= 0) {
        const message = "Open period must be a positive whole number of minutes.";
        setError(message);
        setExamFormFeedback(message);
        return;
      }
      if (parsedOpenPeriodMinutes < policyTimeLimitMinutes) {
        const message = "Open period must be at least the Policy runtime lease.";
        setError(message);
        setExamFormFeedback(message);
        return;
      }
      if (
        policy.storageLeaseMinutes !== null &&
        policy.storageLeaseMinutes !== undefined &&
        parsedOpenPeriodMinutes > policy.storageLeaseMinutes
      ) {
        const message = "Open period must not exceed the Policy storage lease.";
        setError(message);
        setExamFormFeedback(message);
        return;
      }

      const response = await fetchAdmin(
        editingExamId
          ? `/api/admin/exams/${encodeURIComponent(editingExamId)}`
          : "/api/admin/exams",
        {
          method: editingExamId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: examTitle,
            description: examDescription,
            scoreRetrievalEnabled,
            deliveryAvailability,
            allowedRegionIds: selectedAllowedRegionIds,
            policyId: policy.id,
            openPeriodMinutes: parsedOpenPeriodMinutes,
            ...(editingExamId
              ? {}
              : {
                  projectId: project.id,
                  projectName: project.name,
                  blueprintId: blueprint.id,
                  blueprintName: blueprint.name,
                  snapshotId: snapshot.id,
                  snapshotName: snapshot.name,
                  policyName: policy.name,
                }),
          }),
        },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        const message = data.error ?? "Failed to save draft exam";
        setError(message);
        setExamFormFeedback(message);
        return;
      }

      setExamMessage(editingExamId ? "Draft exam updated." : "Draft exam saved.");
      resetExamForm();
      await loadExamCatalog();
      navigateToExamCatalog();
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to save draft exam");
    } finally {
      setLoading(false);
    }
  }

  async function publishCatalogExam(examId: string) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/publish`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to publish exam");
        return;
      }
      setExamMessage("Exam published.");
      await loadExamCatalog();
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to publish exam");
    } finally {
      setLoading(false);
    }
  }

  async function unpublishCatalogExam(examId: string) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const response = await fetchAdmin(`/api/admin/exams/${encodeURIComponent(examId)}/unpublish`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to unpublish exam");
        return;
      }
      setExamMessage("Exam returned to draft.");
      await loadExamCatalog();
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to unpublish exam");
    } finally {
      setLoading(false);
    }
  }

  async function beginEditingExam(exam: ExamRecord) {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      setEditingExamId(exam.id);
      setSelectedProjectId(exam.projectId);
      setSelectedAllowedRegionIds(exam.allowedRegions.map((region) => region.id));
      await loadProjectResources(exam.projectId, false, exam.blueprintId, exam.policyId);
      setSelectedBlueprintId(exam.blueprintId);
      setSelectedPolicyId(exam.policyId);
      await loadBlueprintDetail(exam.projectId, exam.blueprintId, false);
      setExamTitle(exam.title);
      setExamDescription(exam.description);
      setScoreRetrievalEnabled(exam.scoreRetrievalEnabled);
      setDeliveryAvailability(exam.deliveryAvailability ?? "individual");
      setTimeLimitMinutes(String(exam.timeLimitMinutes));
      setOpenPeriodMinutes(String(exam.openPeriodMinutes));
      navigateAdmin({ tab: "exams", examView: "edit", examId: exam.id });
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

  async function createCandidate() {
    setLoading(true);
    setError(null);
    setCandidateMessage(null);
    try {
      const response = await fetchAdmin("/api/admin/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: candidateFirstName,
          lastName: candidateLastName,
          email: candidateEmail,
          password: candidatePassword,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to create Candidate");
        return;
      }

      setCandidateFirstName("");
      setCandidateLastName("");
      setCandidateEmail("");
      setCandidatePassword("");
      setCandidateMessage("Candidate account created.");
      await loadCandidates();
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to create Candidate");
    } finally {
      setLoading(false);
    }
  }

  const hasSavedConnection = connection?.hasConnection ?? false;
  const isVerified = connection?.verifiedAt !== null && connection?.verifiedAt !== undefined;
  const connectionStatusLabel = isVerified
    ? "Verified"
    : hasSavedConnection
      ? "Saved, not yet verified"
      : "No CloudShare Connection saved yet";
  const storedSecretPlaceholder = hasSavedConnection ? "********" : "";
  const webhookCallbackUrl = buildWebhookCallbackUrl(
    webhookPublicBaseUrl,
    connection?.webhookPath,
  );
  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null;
  const selectedBlueprint = blueprints.find((item) => item.id === selectedBlueprintId) ?? null;
  const selectedPolicy = policies.find((item) => item.id === selectedPolicyId) ?? null;
  const authoringMode = getExamAuthoringMode(editingExamId);
  const defaultSnapshot =
    blueprintDetail?.snapshots.find((item) => item.id === blueprintDetail.defaultSnapshotId) ?? null;
  const duplicateExamResourceTupleWarning = getDuplicateExamResourceTupleWarning({
    exams: examCatalog,
    currentExamId: editingExamId,
    projectId: selectedProjectId,
    blueprintId: selectedBlueprintId,
    snapshotId: defaultSnapshot?.id ?? null,
    policyId: selectedPolicyId,
    deliveryAvailability,
  });
  const compatibleRegions = getCompatibleRegions(regions, defaultSnapshot);
  const selectedAllowedRegions = compatibleRegions.filter((region) =>
    selectedAllowedRegionIds.includes(region.id),
  );
  const allowedRegionValidationMessage = getAllowedRegionValidationMessage(
    selectedAllowedRegionIds,
    compatibleRegions,
  );
  const effectiveTimeLimitMinutes =
    selectedPolicy?.runtimeLeaseMinutes !== null && selectedPolicy?.runtimeLeaseMinutes !== undefined
      ? String(selectedPolicy.runtimeLeaseMinutes)
      : timeLimitMinutes;
  const compactFieldStyle = {
    padding: "0.7rem",
    paddingRight: "2.25rem",
    border: "1px solid #ccc",
    borderRadius: "6px",
    width: "100%",
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: "46px",
  } as const;
  const isExamAuthoringView = examView === "create" || examView === "edit";
  const focusedExam = focusedExamId ? (examCatalog.find((exam) => exam.id === focusedExamId) ?? null) : null;
  const focusedExamSessions = focusedExamId ? (cohortSessionsByExamId[focusedExamId] ?? []) : [];
  const focusedCohortSession =
    (focusedCohortSessionId
      ? focusedExamSessions.find((session) => session.session.id === focusedCohortSessionId)
      : null) ??
    (selectedCohortSession?.session.id === focusedCohortSessionId ? selectedCohortSession : null);
  useEffect(() => {
    if (!shouldReconcileAllowedRegionIds(defaultSnapshot)) {
      return;
    }
    const nextSelectedRegionIds = reconcileAllowedRegionIds(selectedAllowedRegionIds, compatibleRegions);
    if (nextSelectedRegionIds.length === selectedAllowedRegionIds.length) {
      return;
    }
    setSelectedAllowedRegionIds(nextSelectedRegionIds);
  }, [compatibleRegions, defaultSnapshot, selectedAllowedRegionIds]);

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
        description="Manage the Helios CX CloudShare Connection, Exam catalog, Candidate accounts, and active ExamAttempt support workflows."
        email={email}
        actions={
          <button onClick={logout} disabled={loading} style={getLogoutButtonStyle(loading)}>
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
              key={t}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (shouldClearAdminBannerOnTabChange(tab, t)) {
                  setError(null);
                  setCandidateMessage(null);
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
          {tab === "exams" && examCorrelationId ? (
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                Open <strong>Support Diagnostics</strong> filtered by correlation ID{" "}
                <span style={{ fontFamily: "monospace" }}>{examCorrelationId}</span>.
              </p>
              <button
                type="button"
                onClick={() => openCorrelationSupportDiagnostics(examCorrelationId)}
                style={{ padding: "0.3rem 0.65rem" }}
              >
                Open Support Diagnostics
              </button>
            </div>
          ) : connectionCorrelationId ? (
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                Open <strong>Support Diagnostics</strong> filtered by correlation ID{" "}
                <span style={{ fontFamily: "monospace" }}>{connectionCorrelationId}</span>.
              </p>
              <button
                type="button"
                onClick={() => openCorrelationSupportDiagnostics(connectionCorrelationId)}
                style={{ padding: "0.3rem 0.65rem" }}
              >
                Open Support Diagnostics
              </button>
            </div>
          ) : null}
        </div>
      )}

      {shouldShowCandidateProvisioning(tab) && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ ...mutedPanelStyle, display: "grid", gap: "0.9rem" }}>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: "0.35rem", fontSize: "1rem" }}>Provision Candidate</h2>
            </div>
            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>First name</span>
                <input
                  value={candidateFirstName}
                  onChange={(event) => setCandidateFirstName(event.target.value)}
                  autoComplete="given-name"
                  minLength={2}
                  style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
                />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Last name</span>
                <input
                  value={candidateLastName}
                  onChange={(event) => setCandidateLastName(event.target.value)}
                  autoComplete="family-name"
                  minLength={2}
                  style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
                />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Candidate email</span>
                <input
                  value={candidateEmail}
                  onChange={(event) => setCandidateEmail(event.target.value)}
                  autoComplete="email"
                  style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
                />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Temporary password</span>
                <input
                  type="password"
                  value={candidatePassword}
                  onChange={(event) => setCandidatePassword(event.target.value)}
                  autoComplete="new-password"
                  style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => void createCandidate()} disabled={loading} style={primaryButtonStyle}>
                Create Candidate
              </button>
              {candidateMessage && <span style={{ color: "#0a7a28" }}>{candidateMessage}</span>}
            </div>
          </div>
          <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px", display: "grid", gap: "0.9rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "end", flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: "0.35rem", flex: "1 1 18rem" }}>
                <span>Search candidates</span>
                <input
                  value={candidateSearch}
                  onChange={(event) => setCandidateSearch(event.target.value)}
                  placeholder="Name or email"
                  style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
                />
              </label>
              <button
                type="button"
                onClick={() => void loadCandidates()}
                disabled={loading}
                style={{ padding: "0.55rem 0.9rem" }}
              >
                Search Candidates
              </button>
            </div>
            <AdminCandidateRosterPanel
              candidates={candidateRoster}
              selectedCandidate={selectedCandidate}
              loading={loading}
              onOpenCandidate={(candidateId) => void loadCandidateDetail(candidateId)}
            />
          </div>
        </section>
      )}

      {tab === "configuration" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={mutedPanelStyle}>
            <p style={{ margin: 0 }}>
              Status:{" "}
              <strong>{connectionStatusLabel}</strong>
            </p>
            {connection?.connectedAt && (
              <p style={{ marginBottom: 0 }}>Saved (UTC): {formatUtcTimestamp(connection.connectedAt)}</p>
            )}
            {connection?.verifiedAt && (
              <p style={{ marginBottom: 0 }}>Verified (UTC): {formatUtcTimestamp(connection.verifiedAt)}</p>
            )}
            {hasSavedConnection && !isVerified && (
              <p style={{ marginBottom: 0, color: "#555" }}>
                Connection details are stored. Run <strong>Test connection</strong> to verify them against CloudShare.
              </p>
            )}
          </div>
          {connectionWarning && (
            <div style={{ ...alertPanelStyle.warning, display: "grid", gap: "0.4rem" }}>
              <p style={{ margin: 0 }}>The CloudShare connection test failed. Support Diagnostics is the primary investigation view.</p>
              {connectionCorrelationId && (
                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
                  <p style={{ margin: 0, fontSize: "0.85rem" }}>
                    Correlation ID: <span style={{ fontFamily: "monospace" }}>{connectionCorrelationId}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => openCorrelationSupportDiagnostics(connectionCorrelationId)}
                    style={{ padding: "0.3rem 0.65rem" }}
                  >
                    Open Support Diagnostics
                  </button>
                </div>
              )}
            </div>
          )}

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>API ID</span>
            <input
              value={apiId}
              onChange={(event) => setApiId(event.target.value)}
              placeholder={hasSavedConnection ? "stored value present" : ""}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
            {hasSavedConnection && !apiId && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                An API ID is stored. Enter a new value only to replace it.
              </span>
            )}
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={storedSecretPlaceholder}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
            {hasSavedConnection && !apiKey && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                A stored API Key is present. Enter a new value only to replace it.
              </span>
            )}
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Webhook Secret</span>
            <input
              type="password"
              value={webhookSecret}
              onChange={(event) => setWebhookSecret(event.target.value)}
              placeholder={storedSecretPlaceholder}
              style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
            />
            {hasSavedConnection && !webhookSecret && (
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                A stored Webhook Secret is present. Enter a new value only to replace it.
              </span>
            )}
          </label>
          {hasSavedConnection && (
            <div style={{ ...alertPanelStyle.info, display: "grid", gap: "0.75rem" }}>
              <div>
                <strong>CloudShare webhook callback</strong>
                <p style={{ margin: "0.35rem 0 0", color: "#45556c" }}>
                  Register this callback manually in CloudShare until v3 webhook auto-registration is live-verified.
                  Select only the environment lifecycle events.
                </p>
              </div>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Public portal base URL</span>
                <input
                  value={webhookPublicBaseUrl}
                  onChange={(event) => setWebhookPublicBaseUrl(event.target.value)}
                  placeholder="https://<current-public-base-url>"
                  style={{ padding: "0.7rem", border: "1px solid #aac4ea", borderRadius: "6px" }}
                />
              </label>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <span>Portal webhook path</span>
                <code style={{ display: "block", overflowWrap: "anywhere", background: "#fff", padding: "0.7rem", borderRadius: "6px", border: "1px solid #d8e5f8" }}>
                  {connection?.webhookPath ?? "Save a CloudShare Connection to generate a path."}
                </code>
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <span>Full CloudShare callback URL</span>
                <code style={{ display: "block", overflowWrap: "anywhere", background: "#fff", padding: "0.7rem", borderRadius: "6px", border: "1px solid #d8e5f8" }}>
                  {webhookCallbackUrl ?? "Enter the public base URL above."}
                </code>
              </div>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  disabled={!webhookCallbackUrl}
                  onClick={() => {
                    if (webhookCallbackUrl) {
                      void navigator.clipboard?.writeText(webhookCallbackUrl);
                      setConnectionMessage("Webhook callback URL copied.");
                    }
                  }}
                  style={{ padding: "0.55rem 0.9rem" }}
                >
                  Copy callback URL
                </button>
                <span style={{ color: "#45556c", fontSize: "0.9rem" }}>
                  Auto-create in CloudShare is deferred until the v3 create request/response is verified.
                </span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button onClick={saveConnection} disabled={loading} style={primaryButtonStyle}>
              {loading ? "Saving..." : "Save CloudShare Connection"}
            </button>
            <button onClick={testConnection} disabled={loading || !connection?.hasConnection} style={secondaryButtonStyle}>
              {loading ? "Testing..." : "Test connection"}
            </button>
          </div>
          {connectionMessage && <p style={{ color: "#0a7a28", margin: 0 }}>{connectionMessage}</p>}
        </section>
      )}

      {tab === "exams" && (
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
              <button type="button" onClick={navigateToExamCreate} disabled={loading} style={primaryButtonStyle}>
                Create Exam
              </button>
            </div>
            <ExamWorkspaceBreadcrumbs
              examView={examView}
              focusedExamTitle={focusedExam?.title ?? null}
              onNavigateToCatalog={navigateToExamCatalog}
            />
          </div>
          {isExamAuthoringView && (
            <>
          <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px", display: "grid", gap: "0.5rem" }}>
            <strong>Project-first Exam authoring</strong>
            <span style={{ color: "#555" }}>
              Regions are global reference data. Blueprints and Policies are fetched in the selected Project context. For experience-based Exams, CloudShare launches always use the Blueprint&apos;s current default snapshot.
            </span>
            <span style={{ color: "#555" }}>
              Instructor choice is fixed to the seeded CloudShare service account for this slice and must be explicitly configured before an Exam can be saved.
            </span>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button onClick={() => void loadExamAuthoring(true)} disabled={loading} style={{ padding: "0.6rem 0.9rem" }}>
                {loading ? "Loading..." : "Refresh Projects & Regions"}
              </button>
              {selectedProjectId && (
                <button
                  onClick={() => void loadProjectResources(selectedProjectId, true)}
                  disabled={loading}
                  style={{ padding: "0.6rem 0.9rem" }}
                >
                  {loading ? "Loading..." : "Refresh Selected Project"}
                </button>
              )}
            </div>
            {authoringMode.tupleChangeHint && (
              <span style={{ color: "#555", fontSize: "0.9rem" }}>{authoringMode.tupleChangeHint}</span>
            )}
          </div>

          {examDiagnostic && (
            <div style={{ color: "#7a4b00", background: "#fff7e6", padding: "0.75rem", borderRadius: "6px", display: "grid", gap: "0.4rem" }}>
              <p style={{ margin: 0 }}>CloudShare resource request failed.</p>
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                {examDiagnostic.method} {examDiagnostic.path} · {examDiagnostic.failureMode}
                {typeof examDiagnostic.responseStatus === "number" ? ` · HTTP ${examDiagnostic.responseStatus}` : ""}
              </p>
            </div>
          )}

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}>
            <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
              <span>Project</span>
              <select
                value={selectedProjectId}
                onChange={(event) => {
                  const nextProjectId = event.target.value;
                  setSelectedProjectId(nextProjectId);
                  setEditingExamId(null);
                  setSelectedBlueprintId("");
                  setBlueprintDetail(null);
                  void loadProjectResources(nextProjectId, true);
                }}
                style={compactFieldStyle}
                disabled={authoringMode.provisioningLocked}
              >
                <option value="">Select a Project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
              <span>Blueprint</span>
              <select
                value={selectedBlueprintId}
                onChange={(event) => {
                  const nextBlueprintId = event.target.value;
                  setSelectedBlueprintId(nextBlueprintId);
                  setEditingExamId(null);
                  setExamFormFeedback(null);
                  setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(selectedPolicy));
                  if (selectedProjectId && nextBlueprintId) {
                    void loadBlueprintDetail(selectedProjectId, nextBlueprintId, true);
                  }
                }}
                style={compactFieldStyle}
                disabled={authoringMode.provisioningLocked}
              >
                <option value="">Select a Blueprint</option>
                {blueprints.map((blueprint) => (
                  <option key={blueprint.id} value={blueprint.id}>
                    {blueprint.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
              <span>Snapshot</span>
              <div
                title={defaultSnapshot ? `${defaultSnapshot.name} (default)` : "Select a Blueprint"}
                style={{
                  ...compactFieldStyle,
                  background: "#f9fafb",
                  color: defaultSnapshot ? "#111" : "#666",
                  fontSize: "0.95rem",
                  lineHeight: "1.2",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {defaultSnapshot ? `${defaultSnapshot.name} (default)` : "Select a Blueprint"}
              </div>
            </label>

            <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
              <span>Policy</span>
              <select
                value={selectedPolicyId}
                onChange={(event) => {
                  const nextPolicyId = event.target.value;
                  const nextPolicy = policies.find((policy) => policy.id === nextPolicyId);
                  setSelectedPolicyId(nextPolicyId);
                  if (nextPolicy?.runtimeLeaseMinutes) {
                    setTimeLimitMinutes(String(nextPolicy.runtimeLeaseMinutes));
                  }
                  setExamFormFeedback(null);
                  setOpenPeriodMinutes(getDefaultOpenPeriodMinutes(nextPolicy));
                }}
                style={compactFieldStyle}
              >
                <option value="">Select a Policy</option>
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem", minWidth: 0 }}>
              <span>Allowed Regions</span>
              <div
                style={{
                  ...compactFieldStyle,
                  background: "#fff",
                  display: "grid",
                  gap: "0.5rem",
                  paddingRight: "0.7rem",
                }}
              >
                {compatibleRegions.length === 0 ? (
                  <span style={{ color: "#666" }}>No deployed Regions found for the current default Snapshot.</span>
                ) : (
                  compatibleRegions.map((region) => (
                    <label key={region.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedAllowedRegionIds.includes(region.id)}
                        onChange={(event) => {
                          setSelectedAllowedRegionIds((current) =>
                            event.target.checked
                              ? [...current, region.id]
                              : current.filter((regionId) => regionId !== region.id),
                          );
                        }}
                      />
                      <span>{region.friendlyName ?? region.name}</span>
                    </label>
                  ))
                )}
              </div>
              {allowedRegionValidationMessage && (
                <span style={{ color: "#b42318", fontSize: "0.85rem" }}>
                  {allowedRegionValidationMessage}
                </span>
              )}
            </label>
          </div>

          <ExamAuthoringSelectionSummary
            selectedProject={selectedProject}
            selectedBlueprint={selectedBlueprint}
            defaultSnapshot={defaultSnapshot}
            selectedAllowedRegions={selectedAllowedRegions}
            selectedPolicy={selectedPolicy}
            deliveryAvailability={deliveryAvailability}
            duplicateExamResourceTupleWarning={duplicateExamResourceTupleWarning}
          />

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "start" }}>
            <label style={{ display: "grid", gap: "0.35rem", gridColumn: "1 / -1" }}>
              <span>Exam title</span>
              <input
                value={examTitle}
                onChange={(event) => setExamTitle(event.target.value)}
                style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem", gridColumn: "1 / -1" }}>
              <span>Description</span>
              <textarea
                value={examDescription}
                onChange={(event) => setExamDescription(event.target.value)}
                rows={4}
                style={{ padding: "0.7rem", border: "1px solid #ccc", borderRadius: "6px" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Time limit (minutes)</span>
              <input
                type="number"
                min={1}
                value={effectiveTimeLimitMinutes}
                readOnly
                style={{ ...compactFieldStyle, background: "#f9fafb" }}
              />
              <span style={{ color: "#666", fontSize: "0.85rem" }}>
                Time limit follows the selected CloudShare Policy runtime lease.
              </span>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Open period (minutes)</span>
              <input
                type="number"
                min={Number(effectiveTimeLimitMinutes) || 1}
                max={selectedPolicy?.storageLeaseMinutes ?? undefined}
                value={openPeriodMinutes}
                onChange={(event) => {
                  setOpenPeriodMinutes(event.target.value);
                  setExamFormFeedback(null);
                }}
                style={compactFieldStyle}
                aria-describedby="exam-open-period-help exam-form-feedback"
              />
              <span id="exam-open-period-help" style={{ color: "#666", fontSize: "0.85rem" }}>
                CloudShare Experience duration from scheduled start; defaults to the Policy runtime lease.
              </span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", gridColumn: "1 / -1" }}>
              <input
                type="checkbox"
                checked={scoreRetrievalEnabled}
                onChange={(event) => setScoreRetrievalEnabled(event.target.checked)}
              />
              <span>Retrieve Guided Journey score for this Exam</span>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Delivery availability</span>
              <select
                value={deliveryAvailability}
                onChange={(event) =>
                  setDeliveryAvailability(event.target.value as "individual" | "cohort" | "both")
                }
                style={compactFieldStyle}
              >
                {getDeliveryAvailabilityAuthoringOptions(deliveryAvailability).map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={saveDraftExam}
              disabled={loading || allowedRegionValidationMessage !== null}
              style={{ padding: "0.7rem 1rem" }}
            >
              {loading ? "Saving..." : editingExamId ? "Update Draft Exam" : "Save Draft Exam"}
            </button>
            {editingExamId && (
              <button onClick={navigateToExamCatalog} disabled={loading} style={{ padding: "0.7rem 1rem" }}>
                Cancel Edit
              </button>
            )}
            {examMessage && <span style={{ color: "#0a7a28" }}>{examMessage}</span>}
          </div>
          {examFormFeedback && (
            <p
              id="exam-form-feedback"
              role="alert"
              style={{
                margin: "-0.25rem 0 0",
                color: "#b42318",
                background: "#fff5f7",
                border: "1px solid #f1c7d0",
                borderRadius: "6px",
                padding: "0.75rem 0.9rem",
              }}
            >
              {examFormFeedback}
            </p>
          )}
            </>
          )}

          {examView === "catalog" && (
          <div>
            <h2 style={{ marginBottom: "0.6rem" }}>Current Exam Catalog</h2>
            <p style={{ marginTop: 0, color: colors.textSecondary }}>
              Open an Exam to manage its draft Cohort Exam Sessions. The catalog overview stays list-only.
            </p>
            <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: colors.surfaceSubtle }}>
                    {["Title", "Status", "Project", "Blueprint / Snapshot", "Allowed Regions", "Policy", "Duration", "Score", "Action"].map((heading) => (
                      <th key={heading} style={{ textAlign: "left", padding: "0.4rem", borderBottom: `1px solid ${colors.border}` }}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {examCatalog.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: "0.5rem", color: colors.textSecondary }}>
                        No exams yet.
                      </td>
                    </tr>
                  )}
                  {examCatalog.map((exam) => (
                    <tr key={exam.id} style={{ borderBottom: `1px solid ${colors.border}`, verticalAlign: "top" }}>
                      <td style={{ padding: "0.4rem" }}>
                        <div style={{ fontWeight: 600 }}>{exam.title}</div>
                        <div style={{ color: colors.textSecondary }}>{exam.description}</div>
                        <div style={{ color: colors.textSecondary, fontSize: "0.75rem", marginTop: "0.25rem" }}>
                          Exam ID: {formatShortExamId(exam.id)}
                          {exam.createdAt ? ` · Created ${formatUtcTimestamp(exam.createdAt)}` : ""} · Delivery:{" "}
                          {formatExamDeliveryAvailability(exam.deliveryAvailability)}
                        </div>
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        <span style={statusBadgeStyle(getExamStatusTone(exam.status))}>{exam.status}</span>
                        {exam.publishedAt && (
                          <div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>
                            {formatUtcTimestamp(exam.publishedAt)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.4rem" }}>{exam.projectName}</td>
                      <td style={{ padding: "0.4rem" }}>
                        <div>{exam.blueprintName}</div>
                        <div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>{exam.snapshotName}</div>
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        {exam.allowedRegions.map((region) => region.name).join(", ")}
                      </td>
                      <td style={{ padding: "0.4rem" }}>{exam.policyName}</td>
                      <td style={{ padding: "0.4rem" }}>
                        <div>{exam.timeLimitMinutes} min runtime</div>
                        <div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>
                          {exam.openPeriodMinutes} min open
                        </div>
                        {exam.storageLeaseMinutes ? (
                          <div style={{ color: colors.textSecondary, fontSize: "0.75rem" }}>
                            {exam.storageLeaseMinutes} min storage
                          </div>
                        ) : null}
                      </td>
                      <td style={{ padding: "0.4rem" }}>{exam.scoreRetrievalEnabled ? "Enabled" : "Off"}</td>
                      <td style={{ padding: "0.4rem" }}>
                        <ExamCatalogRowActions
                          exam={exam}
                          loading={loading}
                          editingExamId={editingExamId}
                          onEdit={() => void beginEditingExam(exam)}
                          onPublish={() => void publishCatalogExam(exam.id)}
                          onUnpublish={() => void unpublishCatalogExam(exam.id)}
                          onManageCohortSessions={() => navigateToExamSessions(exam.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
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

      {tab === "support" && supportView === "audit" && (
        <section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1rem",
              alignItems: "end",
            }}
          >
            <input
              placeholder="ExamAttempt ID"
              value={auditFilters.examAttemptId}
              onChange={(e) => setAuditFilter("examAttemptId", e.target.value)}
              style={{ padding: "0.4rem" }}
            />
            <input
              placeholder="Action"
              value={auditFilters.action}
              onChange={(e) => setAuditFilter("action", e.target.value)}
              style={{ padding: "0.4rem" }}
            />
            <select
              value={auditFilters.outcome}
              onChange={(e) => setAuditFilter("outcome", e.target.value)}
              style={{ padding: "0.4rem" }}
            >
              <option value="">Any outcome</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="denied">Denied</option>
            </select>
            <input
              placeholder="Actor email"
              value={auditFilters.actorEmail}
              onChange={(e) => setAuditFilter("actorEmail", e.target.value)}
              style={{ padding: "0.4rem" }}
            />
            <input
              placeholder="Subject type"
              value={auditFilters.subjectType}
              onChange={(e) => setAuditFilter("subjectType", e.target.value)}
              style={{ padding: "0.4rem" }}
            />
            <input
              placeholder="Subject ID"
              value={auditFilters.subjectId}
              onChange={(e) => setAuditFilter("subjectId", e.target.value)}
              style={{ padding: "0.4rem" }}
            />
            <input
              placeholder="Exam ID"
              value={auditFilters.examId}
              onChange={(e) => setAuditFilter("examId", e.target.value)}
              style={{ padding: "0.4rem" }}
            />
            <button onClick={applyAuditFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              {loading ? "Loading..." : "Apply Filters"}
            </button>
            <button onClick={clearAuditFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              Clear Filters
            </button>
            <button onClick={() => void loadAudit()} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              Refresh Page
            </button>
          </div>
          {auditRecords && (
            <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: colors.surfaceSubtle }}>
                    {["Time", "Actor", "Subject", "ExamAttempt", "Action", "Outcome", "Details / Error"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: `1px solid ${colors.border}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditRecords.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "0.5rem", color: colors.textSecondary }}>
                        No records found
                      </td>
                    </tr>
                  )}
                  {auditRecords.map((r) => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                        {formatUtcTimestamp(r.occurredAt)}
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        {r.actorEmail ?? r.actorId ?? r.actorType ?? "-"}
                      </td>
                      <td style={{ padding: "0.4rem" }}>
                        {r.subjectType || r.subjectId
                          ? `${r.subjectType ?? "subject"}:${r.subjectId ?? "-"}`
                          : r.examId ?? "-"}
                      </td>
                      <td style={{ padding: "0.4rem" }}>{r.examAttemptId ?? "-"}</td>
                      <td style={{ padding: "0.4rem" }}>{r.action}</td>
                      <td style={{ padding: "0.4rem", color: r.outcome === "success" ? colors.success : colors.danger, fontWeight: "bold" }}>
                        {r.outcome}
                      </td>
                      <td style={{ padding: "0.4rem", fontSize: "0.8rem", color: "#444" }}>
                        {r.error ?? (r.details ? JSON.stringify(r.details) : "-")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "support" && supportView === "monitoring" && (
        monitoring ? (
          <SessionMonitoringPanel
            monitoring={monitoring}
            loading={loading}
            onRefresh={() => void loadMonitoring()}
            onLoadMoreHistory={loadMoreMonitoringHistory}
            onOpenSupportDiagnostics={openExamAttemptSupportDiagnostics}
          />
        ) : (
          <section>
            <button onClick={() => void loadMonitoring()} disabled={loading} style={{ padding: "0.45rem 0.9rem" }}>
              {loading ? "Loading..." : "Refresh Monitoring"}
            </button>
          </section>
        )
      )}

      {tab === "support" && supportView === "diagnostics" && (
        <section>
          <p style={{ color: colors.textSecondary, marginTop: 0 }}>
            The correlated diagnostic log: what the portal did, in what order, and how to trace it.
            Entries are append-only and scoped to your Customer. This is the primary support workflow.
            Session Monitoring remains the current-state queue view and should link into this tab for
            forensic investigation. Timestamps are ISO 8601 in UTC. Secrets and credentials are redacted.
          </p>
          <div
            style={{
              border: "1px solid #dfe3eb",
              borderRadius: "8px",
              background: "#f8fafc",
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <div style={{ marginBottom: "0.9rem" }}>
              <h2 style={{ margin: 0, fontSize: "1rem" }}>Investigative filters</h2>
              <p style={{ color: colors.textSecondary, margin: "0.35rem 0 0" }}>
                Follow an ExamAttempt, correlation thread, or CloudShare event without changing the
                underlying diagnostic filtering rules.
              </p>
            </div>
            <div style={{ display: "grid", gap: "0.9rem" }}>
              <fieldset
                style={{
                  margin: 0,
                  border: "1px solid #d7dce4",
                  borderRadius: "8px",
                  padding: "0.8rem",
                  minWidth: 0,
                  background: "#fff",
                }}
              >
                <legend style={{ padding: "0 0.35rem", fontWeight: 600 }}>Investigation thread</legend>
                <div
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    alignItems: "end",
                  }}
                >
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>ExamAttempt ID</span>
                    <input
                      value={diagnosticFilters.examAttemptId ?? ""}
                      onChange={(event) => setDiagnosticFilter("examAttemptId", event.target.value)}
                      placeholder="attempt-123"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Correlation ID</span>
                    <input
                      value={diagnosticFilters.correlationId ?? ""}
                      onChange={(event) => setDiagnosticFilter("correlationId", event.target.value)}
                      placeholder="corr-123"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Candidate email</span>
                    <input
                      value={diagnosticFilters.candidateEmail ?? ""}
                      onChange={(event) => setDiagnosticFilter("candidateEmail", event.target.value)}
                      placeholder="candidate@helioscx.demo"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Exam ID</span>
                    <input
                      value={diagnosticFilters.examId ?? ""}
                      onChange={(event) => setDiagnosticFilter("examId", event.target.value)}
                      placeholder="exam-123"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>CloudShare / external ID</span>
                    <input
                      value={diagnosticFilters.externalId ?? ""}
                      onChange={(event) => setDiagnosticFilter("externalId", event.target.value)}
                      placeholder="env-123"
                    />
                  </label>
                </div>
              </fieldset>
              <fieldset
                style={{
                  margin: 0,
                  border: "1px solid #d7dce4",
                  borderRadius: "8px",
                  padding: "0.8rem",
                  minWidth: 0,
                  background: "#fff",
                }}
              >
                <legend style={{ padding: "0 0.35rem", fontWeight: 600 }}>Event details</legend>
                <div
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    alignItems: "end",
                  }}
                >
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Operation</span>
                    <input
                      value={diagnosticFilters.operation ?? ""}
                      onChange={(event) => setDiagnosticFilter("operation", event.target.value)}
                      placeholder="exam_attempt.resume"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Outcome</span>
                    <select
                      value={diagnosticFilters.outcome ?? ""}
                      onChange={(event) =>
                        setDiagnosticFilter(
                          "outcome",
                          (event.target.value || undefined) as DiagnosticLogFilters["outcome"],
                        )
                      }
                    >
                      <option value="">All</option>
                      <option value="success">Success</option>
                      <option value="failure">Failure</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Source</span>
                    <input
                      value={diagnosticFilters.source ?? ""}
                      onChange={(event) => setDiagnosticFilter("source", event.target.value)}
                      placeholder="runtime"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>Integration surface</span>
                    <input
                      value={diagnosticFilters.integrationSurface ?? ""}
                      onChange={(event) => setDiagnosticFilter("integrationSurface", event.target.value)}
                      placeholder="cloudshare.v4.environment"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>From (UTC ISO)</span>
                    <input
                      value={diagnosticFilters.from ?? ""}
                      onChange={(event) => setDiagnosticFilter("from", event.target.value)}
                      placeholder="2026-06-21T10:00:00.000Z"
                    />
                  </label>
                  <label style={{ display: "grid", gap: "0.35rem" }}>
                    <span>To (UTC ISO)</span>
                    <input
                      value={diagnosticFilters.to ?? ""}
                      onChange={(event) => setDiagnosticFilter("to", event.target.value)}
                      placeholder="2026-06-21T11:00:00.000Z"
                    />
                  </label>
                </div>
              </fieldset>
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                marginTop: "0.9rem",
              }}
            >
              <button onClick={applyDiagnosticFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
                {loading ? "Loading..." : "Apply Filters"}
              </button>
              <button onClick={clearDiagnosticFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
                Clear Filters
              </button>
              <button onClick={onLoadDiagnostics} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
                Refresh Page
              </button>
            </div>
          </div>
          {diagnosticPage && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.75rem",
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: "0.75rem",
              }}
            >
              <div style={{ color: colors.textSecondary }}>
                Showing {diagnosticPage.returned} entries starting at row {diagnosticPage.offset + 1}.
              </div>
              <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button
                  onClick={loadPreviousDiagnosticPage}
                  disabled={loading || (diagnosticPage.offset ?? 0) === 0}
                  style={{ padding: "0.4rem 1rem" }}
                >
                  Previous
                </button>
                <button
                  onClick={loadNextDiagnosticPage}
                  disabled={loading || !diagnosticPage.hasMore}
                  style={{ padding: "0.4rem 1rem" }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
          {diagnosticFilters.examAttemptId ? (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.65rem 0.8rem",
                border: "1px solid #dbe4ff",
                borderRadius: "8px",
                background: "#f5f8ff",
                color: "#123",
              }}
            >
              Filtered to ExamAttempt ID{" "}
              <span style={{ fontFamily: "monospace" }}>{diagnosticFilters.examAttemptId}</span>.
            </div>
          ) : null}
          {!diagnosticFilters.examAttemptId && diagnosticFilters.correlationId ? (
            <div
              style={{
                marginBottom: "0.75rem",
                padding: "0.65rem 0.8rem",
                border: "1px solid #dbe4ff",
                borderRadius: "8px",
                background: "#f5f8ff",
                color: "#123",
              }}
            >
              Filtered to correlation ID{" "}
              <span style={{ fontFamily: "monospace" }}>{diagnosticFilters.correlationId}</span>.
            </div>
          ) : null}
          {diagnosticEntries && (
            <DiagnosticLogTable
              entries={diagnosticEntries}
              expandedDiagnosticId={expandedDiagnosticId}
              onToggleExpanded={(id) =>
                setExpandedDiagnosticId(expandedDiagnosticId === id ? null : id)
              }
              onOpenExamAttempt={openExamAttemptSupportDiagnostics}
            />
          )}
        </section>
      )}

    </main>
  );
}

