"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  ADMIN_SESSION_EXPIRED_MESSAGE,
  type AdminTab,
  beginLatestOnlyRequest,
  buildSupportWorkbenchQuery,
  buildWebhookCallbackUrl,
  buildEventRecordRowKey,
  getAdminTabLabel,
  getAllowedRegionValidationMessage,
  getCompatibleRegions,
  getExamAuthoringMode,
  isAdminSessionExpiredStatus,
  isLatestOnlyResponse,
  reconcileAllowedRegionIds,
  SUPPORT_WORKBENCH_DEFAULT_LIMIT,
  shouldClearAdminBannerOnTabChange,
  shouldShowCandidateProvisioning,
} from "./admin-console-state";
import type {
  AdminMonitoringView as MonitoringView,
  MonitoringAttemptView as MonitoringAttempt,
  MonitoringAttemptResult,
  MonitoringTimelineEntry,
} from "@/domain/admin-monitoring";

interface AdminConsoleProps {
  readonly email: string;
}

interface ConnectionState {
  hasConnection: boolean;
  connectedAt: string | null;
  verifiedAt: string | null;
  webhookPath: string | null;
}

interface AuditRecord {
  id: string;
  examAttemptId: string;
  candidateId?: string;
  action: string;
  outcome: "success" | "failure";
  details?: Record<string, unknown>;
  error?: string;
  occurredAt: string;
}

interface EventLogRecord {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface SupportLogRecord {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown>;
}

interface SupportWorkbenchDiagnostic {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  operation: string | null;
  integrationSurface: string | null;
  customerId: string | null;
  webhookPathToken: string | null;
  method: string | null;
  path: string | null;
  requestBodyBytes: number | null;
  rawBodySha256: string | null;
  signaturePresent: boolean | null;
  rawRequestBody: string | null;
  trustGateReason: string | null;
}

interface SupportWorkbenchResponseBody {
  summary: {
    scheduled: number;
    ready: number;
    inProgress: number;
    suspended: number;
    completed: number;
    expired: number;
  };
  currentQueues: {
    scheduled: MonitoringAttempt[];
    ready: MonitoringAttempt[];
    inProgress: MonitoringAttempt[];
    suspended: MonitoringAttempt[];
  };
  matchingAttempts: MonitoringAttempt[];
  meta: {
    totalMatchingAttempts: number;
    limit: number;
    returnedAttempts: number;
    defaultLimitApplied: boolean;
    currentQueueLimit: number;
    currentQueueTotals: {
      scheduled: number;
      ready: number;
      inProgress: number;
      suspended: number;
    };
  };
  diagnostics: SupportWorkbenchDiagnostic[];
}

interface SupportWorkbenchFilterState {
  candidate: string;
  examId: string;
  status: string;
  scheduledFrom: string;
  scheduledTo: string;
  limit: string;
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

interface SyncResult {
  synced: number;
  byType: Record<string, Array<{ name: string; cloudshareId: string; syncedAt: string }>>;
}

interface NamedResource {
  id: string;
  name: string;
  friendlyName?: string;
  description?: string;
  runtimeLeaseMinutes?: number | null;
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
  scoreRetrievalEnabled: boolean;
  status: "draft" | "published";
  publishedAt: string | null;
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

function formatUtcTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function readStringField(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const value = fields[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberField(
  fields: Record<string, unknown>,
  key: string,
): number | null {
  const value = fields[key];
  return typeof value === "number" ? value : null;
}

function formatSupportValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

const WEBHOOK_SUPPORT_FIELD_LABELS: Array<{ key: string; label: string }> = [
  { key: "webhookEvent", label: "Event" },
  { key: "webhookCreatedAt", label: "CreatedAt" },
  { key: "webhookCreatedById", label: "CreatedById" },
  { key: "webhookCreatedByEmail", label: "CreatedByEmail" },
  { key: "webhookAttempt", label: "Attempt" },
  { key: "webhookEnvironmentId", label: "EnvironmentId" },
  { key: "webhookEnvironmentExternalId", label: "EnvironmentExternalId" },
  { key: "webhookEnvironmentName", label: "EnvironmentName" },
  { key: "webhookBlueprintId", label: "BlueprintId" },
  { key: "webhookBlueprintName", label: "BlueprintName" },
  { key: "webhookPolicyId", label: "PolicyId" },
  { key: "webhookPolicyName", label: "PolicyName" },
  { key: "webhookOwnerEmail", label: "OwnerEmail" },
  { key: "webhookCloud", label: "Cloud" },
  { key: "webhookRegionId", label: "RegionId" },
];

function getWebhookSupportFieldRows(
  fields: Record<string, unknown>,
): Array<{ label: string; value: unknown }> {
  return WEBHOOK_SUPPORT_FIELD_LABELS
    .map(({ key, label }) => ({ label, value: fields[key] }))
    .filter(({ value }) => value !== undefined && value !== null && value !== "");
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

function formatAttemptStatus(status: MonitoringAttempt["status"]): string {
  return status.replaceAll("_", " ");
}

function formatMonitoringResult(result: MonitoringAttemptResult | undefined): string {
  if (!result) {
    return "-";
  }
  if (!result.scoreAvailable) {
    return formatAttemptStatus(result.status);
  }
  const percent = typeof result.percentComplete === "number" ? `${result.percentComplete}%` : "Score";
  const steps =
    typeof result.stepsCompleted === "number" && typeof result.stepsTotal === "number"
      ? ` (${result.stepsCompleted}/${result.stepsTotal} steps)`
      : "";
  return `${percent}${steps}`;
}

function formatTimelineEntry(entry: MonitoringTimelineEntry): string {
  if (entry.kind === "audit") {
    return entry.error ?? (entry.details ? JSON.stringify(entry.details) : "-");
  }
  const status = typeof entry.responseStatus === "number" ? `HTTP ${entry.responseStatus}` : entry.failureMode ?? "failure";
  const attemptedOperation = entry.attemptedOperation ? `${entry.attemptedOperation} ` : "";
  return `${attemptedOperation}${status}`.trim();
}

function renderAttemptCollection(
  label: string,
  attempts: readonly MonitoringAttempt[],
  emptyMessage: string,
  totalCount?: number,
) {
  const visibleCount = attempts.length;
  const headingCount =
    typeof totalCount === "number" && totalCount > visibleCount
      ? `${visibleCount} of ${totalCount}`
      : String(visibleCount);

  return (
    <div key={label} style={{ background: "#f7f7f8", borderRadius: "8px", padding: "1rem" }}>
      <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
        {label} ({headingCount})
      </h2>
      {typeof totalCount === "number" && totalCount > visibleCount && (
        <div style={{ marginBottom: "0.75rem", color: "#666", fontSize: "0.85rem" }}>
          Queue truncated to the first {visibleCount} attempts for this view.
        </div>
      )}
      {attempts.length === 0 ? (
        <p style={{ margin: 0, color: "#666" }}>{emptyMessage}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {attempts.map((attempt) => (
            <details
              key={attempt.id}
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                padding: "0.75rem 0.9rem",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                {attempt.candidateName} · {attempt.examTitle} ·{" "}
                {attempt.result ? formatMonitoringResult(attempt.result) : formatAttemptStatus(attempt.status)}
              </summary>
              <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
                <div>Candidate: {attempt.candidateEmail}</div>
                <div>Status: {formatAttemptStatus(attempt.status)}</div>
                <div>Scheduled (UTC): {formatUtcTimestamp(attempt.scheduledFor)}</div>
                <div>Training ID: {attempt.trainingId ?? "-"}</div>
                <div>Environment: {attempt.environmentExternalId ?? "-"}</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ background: "#f5f5f5" }}>
                        {["Time", "Kind", "Event", "Outcome", "Details"].map((heading) => (
                          <th
                            key={heading}
                            style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #ddd" }}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {attempt.timeline.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: "0.4rem", color: "#666" }}>
                            No timeline entries recorded.
                          </td>
                        </tr>
                      )}
                      {attempt.timeline.map((entry, index) => (
                        <tr
                          key={`${attempt.id}-${entry.occurredAt}-${entry.kind}-${index}`}
                          style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}
                        >
                          <td style={{ padding: "0.35rem", whiteSpace: "nowrap" }}>
                            {formatUtcTimestamp(entry.occurredAt)}
                          </td>
                          <td style={{ padding: "0.35rem" }}>{entry.kind}</td>
                          <td style={{ padding: "0.35rem" }}>
                            {entry.kind === "audit" ? entry.action : entry.eventType}
                          </td>
                          <td style={{ padding: "0.35rem" }}>
                            {entry.kind === "audit"
                              ? entry.outcome
                              : (typeof entry.responseStatus === "number"
                                ? `HTTP ${entry.responseStatus}`
                                : entry.failureMode ?? "-")}
                          </td>
                          <td style={{ padding: "0.35rem", color: "#444" }}>{formatTimelineEntry(entry)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

class AdminSessionExpiredError extends Error {
  constructor() {
    super(ADMIN_SESSION_EXPIRED_MESSAGE);
    this.name = "AdminSessionExpiredError";
  }
}

function isAdminSessionExpiredError(error: unknown): error is AdminSessionExpiredError {
  return error instanceof AdminSessionExpiredError;
}

export function AdminConsole({ email }: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>("connection");
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
  const [scoreRetrievalEnabled, setScoreRetrievalEnabled] = useState(false);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examCatalog, setExamCatalog] = useState<ExamRecord[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringView | null>(null);
  const [examMessage, setExamMessage] = useState<string | null>(null);
  const [examDiagnostic, setExamDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [examCorrelationId, setExamCorrelationId] = useState<string | null>(null);
  const projectResourcesRequestIdRef = useRef(0);
  const blueprintDetailRequestIdRef = useRef(0);
  const [examAttemptFilter, setExamAttemptFilter] = useState("");
  const [auditRecords, setAuditRecords] = useState<AuditRecord[] | null>(null);
  const [eventRecords, setEventRecords] = useState<EventLogRecord[] | null>(null);
  const [supportRecords, setSupportRecords] = useState<SupportLogRecord[] | null>(null);
  const [supportWorkbench, setSupportWorkbench] = useState<SupportWorkbenchResponseBody | null>(null);
  const [supportCandidateFilter, setSupportCandidateFilter] = useState("");
  const [supportExamFilter, setSupportExamFilter] = useState("");
  const [supportStatusFilter, setSupportStatusFilter] = useState("");
  const [supportScheduledFromFilter, setSupportScheduledFromFilter] = useState("");
  const [supportScheduledToFilter, setSupportScheduledToFilter] = useState("");
  const [supportLimitFilter, setSupportLimitFilter] = useState(
    String(SUPPORT_WORKBENCH_DEFAULT_LIMIT),
  );
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    void loadConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "exams") {
      void loadExamCatalog();
      void loadExamAuthoring();
    }
    if (tab === "monitoring") {
      void loadMonitoring();
    }
    if (tab === "support") {
      if (examCatalog.length === 0) {
        void loadExamCatalog();
      }
      void loadSupportWorkbench();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function handleAdminSessionExpired() {
    setSessionExpired(true);
    setError(ADMIN_SESSION_EXPIRED_MESSAGE);
    setConnectionCorrelationId(null);
    setExamCorrelationId(null);
    setConnectionDiagnostic(null);
    setExamDiagnostic(null);
    router.replace("/login");
    router.refresh();
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
        setConnectionWarning("CloudShare connection test failed. Check the warning details and support log.");
        setConnectionDiagnostic(data.diagnostic ?? null);
        setConnectionCorrelationId(data.correlationId ?? null);
        setConnectionOccurredAt(data.occurredAt ?? null);
        void loadSupportLog(true);
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
      setConnectionWarning("CloudShare connection test failed. Check the support log for more detail.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const qs = examAttemptFilter.trim()
        ? `?examAttemptId=${encodeURIComponent(examAttemptFilter.trim())}`
        : "";
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

  async function loadMonitoring() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmin("/api/admin/monitoring");
      const data = (await res.json()) as { monitoring?: MonitoringView; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load session monitoring");
        return;
      }
      setMonitoring(data.monitoring ?? null);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load session monitoring");
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmin("/api/admin/events?limit=100");
      const data = await res.json() as { events?: EventLogRecord[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load event log");
        return;
      }
      setEventRecords(data.events ?? []);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load event log");
    } finally {
      setLoading(false);
    }
  }

  async function loadSupportLog(background = false) {
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetchAdmin("/api/admin/support-log?limit=200");
      const data = await res.json() as { records?: SupportLogRecord[]; error?: string };
      if (!res.ok) {
        if (!background) {
          setError(data.error ?? "Failed to load support log");
        }
        return;
      }
      setSupportRecords(data.records ?? []);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      if (!background) {
        setError("Failed to load support log");
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  async function loadSupportWorkbench(
    background = false,
    overrides?: Partial<SupportWorkbenchFilterState>,
  ) {
    if (!background) {
      setLoading(true);
      setError(null);
      setSupportRecords(null);
    }
    try {
      const filters: SupportWorkbenchFilterState = {
        candidate: overrides?.candidate ?? supportCandidateFilter,
        examId: overrides?.examId ?? supportExamFilter,
        status: overrides?.status ?? supportStatusFilter,
        scheduledFrom: overrides?.scheduledFrom ?? supportScheduledFromFilter,
        scheduledTo: overrides?.scheduledTo ?? supportScheduledToFilter,
        limit: overrides?.limit ?? supportLimitFilter,
      };
      const query = buildSupportWorkbenchQuery({
        candidate: filters.candidate,
        examId: filters.examId,
        status: filters.status,
        scheduledFrom: filters.scheduledFrom,
        scheduledTo: filters.scheduledTo,
        limit: filters.limit,
      });
      const res = await fetchAdmin(`/api/admin/support-workbench${query}`);
      const data = (await res.json()) as SupportWorkbenchResponseBody & { error?: string };
      if (!res.ok) {
        if (!background) {
          setError(data.error ?? "Failed to load support workbench");
        }
        return;
      }
      setSupportWorkbench(data);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      if (!background) {
        setError("Failed to load support workbench");
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  function onLoadSupportLog() {
    void loadSupportLog();
  }

  function onLoadSupportWorkbench() {
    void loadSupportWorkbench();
  }

  function resetSupportWorkbenchFilters() {
    setSupportCandidateFilter("");
    setSupportExamFilter("");
    setSupportStatusFilter("");
    setSupportScheduledFromFilter("");
    setSupportScheduledToFilter("");
    setSupportLimitFilter(String(SUPPORT_WORKBENCH_DEFAULT_LIMIT));
  }

  function onResetSupportWorkbenchFilters() {
    resetSupportWorkbenchFilters();
    setSupportWorkbench(null);
    void loadSupportWorkbench(false, {
      candidate: "",
      examId: "",
      status: "",
      scheduledFrom: "",
      scheduledTo: "",
      limit: String(SUPPORT_WORKBENCH_DEFAULT_LIMIT),
    });
  }

  function resetExamForm(next?: {
    title?: string;
    description?: string;
    scoreRetrievalEnabled?: boolean;
    timeLimitMinutes?: string;
  }) {
    setEditingExamId(null);
    setExamMessage(null);
    setExamTitle(next?.title ?? blueprintDetail?.name ?? "");
    setExamDescription(next?.description ?? stripHtmlToText(blueprintDetail?.description) ?? "");
    setScoreRetrievalEnabled(next?.scoreRetrievalEnabled ?? false);
    setTimeLimitMinutes(next?.timeLimitMinutes ?? "");
  }

  async function syncResources() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdmin("/api/admin/sync-resources", { method: "POST" });
      const data = await res.json() as SyncResult | { error: string };
      if ("error" in data) {
        setError(data.error);
      } else {
        setSyncResult(data);
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Sync request failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadExamAuthoring(refresh = false) {
    setLoading(true);
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
        void loadSupportLog(true);
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
        void loadProjectResources(projectId, true);
      }
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load exam authoring resources");
    } finally {
      setLoading(false);
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
        void loadSupportLog(true);
        return;
      }

      if (!isLatestOnlyResponse(projectResourcesRequestIdRef.current, requestId)) {
        return;
      }

      const nextBlueprints = data.blueprints ?? [];
      const nextPolicies = data.policies ?? [];
      setBluePrintState(nextBlueprints, nextPolicies, preferredPolicyId);
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
        void loadBlueprintDetail(projectId, blueprintId, refresh);
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
    }
  }

  function setBluePrintState(
    nextBlueprints: NamedResource[],
    nextPolicies: NamedResource[],
    preferredPolicyId?: string,
  ) {
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
  }

  async function loadBlueprintDetail(projectId: string, blueprintId: string, refresh = false) {
    const requestId = beginLatestOnlyRequest(blueprintDetailRequestIdRef.current);
    blueprintDetailRequestIdRef.current = requestId;
    setLoading(true);
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
        void loadSupportLog(true);
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
      if (!editingExamId && detail) {
        setExamTitle(detail.name);
        setExamDescription(stripHtmlToText(detail.description));
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
    }
  }

  async function loadExamCatalog() {
    try {
      const response = await fetchAdmin("/api/admin/exams");
      const data = (await response.json()) as { exams?: ExamRecord[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to load exam catalog");
        return;
      }
      setExamCatalog(data.exams ?? []);
    } catch (caughtError) {
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      setError("Failed to load exam catalog");
    }
  }

  async function saveDraftExam() {
    setLoading(true);
    setError(null);
    setExamMessage(null);
    try {
      const project = projects.find((item) => item.id === selectedProjectId);
      const blueprint = blueprints.find((item) => item.id === selectedBlueprintId);
      const policy = policies.find((item) => item.id === selectedPolicyId);
      const snapshot = blueprintDetail?.snapshots.find(
        (item) => item.id === blueprintDetail.defaultSnapshotId,
      );
      const policyTimeLimitMinutes = policy?.runtimeLeaseMinutes ?? null;
      const validationMessage = getAllowedRegionValidationMessage(
        selectedAllowedRegionIds,
        compatibleRegions,
      );

      if (validationMessage) {
        setError(validationMessage);
        return;
      }

      if (!project || !blueprint || !policy || !snapshot || !policyTimeLimitMinutes) {
        setError("Select a project, blueprint, policy, and allowed Region set before saving the Exam.");
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
            allowedRegionIds: selectedAllowedRegionIds,
            policyId: policy.id,
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
        setError(data.error ?? "Failed to save draft exam");
        return;
      }

      setExamMessage(editingExamId ? "Draft exam updated." : "Draft exam saved.");
      resetExamForm();
      await loadExamCatalog();
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
      setSelectedProjectId(exam.projectId);
      setSelectedAllowedRegionIds(exam.allowedRegions.map((region) => region.id));
      await loadProjectResources(exam.projectId, false, exam.blueprintId, exam.policyId);
      setSelectedBlueprintId(exam.blueprintId);
      setSelectedPolicyId(exam.policyId);
      await loadBlueprintDetail(exam.projectId, exam.blueprintId, false);
      setEditingExamId(exam.id);
      setExamTitle(exam.title);
      setExamDescription(exam.description);
      setScoreRetrievalEnabled(exam.scoreRetrievalEnabled);
      setTimeLimitMinutes(String(exam.timeLimitMinutes));
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
  const blueprintSummary = selectedBlueprint
    ? stripHtmlToText(selectedBlueprint.description || blueprintDetail?.description || "")
    : "";

  useEffect(() => {
    const nextSelectedRegionIds = reconcileAllowedRegionIds(selectedAllowedRegionIds, compatibleRegions);
    if (nextSelectedRegionIds.length === selectedAllowedRegionIds.length) {
      return;
    }
    setSelectedAllowedRegionIds(nextSelectedRegionIds);
  }, [compatibleRegions, selectedAllowedRegionIds]);

  if (sessionExpired) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
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
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "1000px",
        margin: "0 auto",
        minHeight: "100vh",
        scrollbarGutter: "stable",
      }}
    >
      <h1 style={{ marginBottom: "0.35rem" }}>Certalis Admin Console</h1>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#555" }}>Signed in as {email}</p>
        <button onClick={logout} disabled={loading} style={{ padding: "0.55rem 0.9rem" }}>
          Log out
        </button>
      </div>
      <nav style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {ADMIN_TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              if (shouldClearAdminBannerOnTabChange(tab, t)) {
                setError(null);
                setCandidateMessage(null);
              }
              setTab(t);
            }}
            style={{
              padding: "0.5rem 0.9rem",
              background: tab === t ? "#111827" : "#eee",
              color: tab === t ? "#fff" : "#111",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {getAdminTabLabel(t)}
          </button>
        ))}
      </nav>

      {error && (
        <div style={{ color: "#b00020", background: "#fff0f0", padding: "0.75rem", borderRadius: "6px", display: "grid", gap: "0.5rem" }}>
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
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              See <strong>Support Log</strong> with correlation ID{" "}
              <span style={{ fontFamily: "monospace" }}>{examCorrelationId}</span>.
            </p>
          ) : connectionCorrelationId ? (
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              See <strong>Support Log</strong> with correlation ID{" "}
              <span style={{ fontFamily: "monospace" }}>{connectionCorrelationId}</span>.
            </p>
          ) : null}
        </div>
      )}

      {shouldShowCandidateProvisioning(tab) && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px", display: "grid", gap: "0.9rem" }}>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: "0.35rem", fontSize: "1rem" }}>Provision Candidate</h2>
              <p style={{ margin: 0, color: "#555" }}>
                Create a Candidate account for Helios CX. Candidate list, edit, and reset-password management are intentionally deferred from this slice.
              </p>
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
              <button onClick={() => void createCandidate()} disabled={loading}>
                Create Candidate
              </button>
              {candidateMessage && <span style={{ color: "#0a7a28" }}>{candidateMessage}</span>}
            </div>
          </div>
        </section>
      )}

      {tab === "connection" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ padding: "1rem", background: "#f7f7f8", borderRadius: "6px" }}>
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
            <div style={{ color: "#7a4b00", background: "#fff7e6", padding: "0.75rem", borderRadius: "6px", display: "grid", gap: "0.4rem" }}>
              <p style={{ margin: 0 }}>The CloudShare connection test failed. Check the Support Log for details.</p>
              {connectionCorrelationId && (
                <p style={{ margin: 0, fontSize: "0.85rem" }}>
                  Correlation ID: <span style={{ fontFamily: "monospace" }}>{connectionCorrelationId}</span>
                </p>
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
            <div style={{ padding: "1rem", background: "#eef6ff", border: "1px solid #c7ddff", borderRadius: "6px", display: "grid", gap: "0.75rem" }}>
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
            <button onClick={saveConnection} disabled={loading} style={{ padding: "0.7rem 1rem" }}>
              {loading ? "Saving..." : "Save CloudShare Connection"}
            </button>
            <button onClick={testConnection} disabled={loading || !connection?.hasConnection} style={{ padding: "0.7rem 1rem" }}>
              {loading ? "Testing..." : "Test connection"}
            </button>
          </div>
          {connectionMessage && <p style={{ color: "#0a7a28", margin: 0 }}>{connectionMessage}</p>}
        </section>
      )}

      {tab === "exams" && (
        <section style={{ display: "grid", gap: "1rem" }}>
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
                  setSelectedPolicyId(event.target.value);
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
            <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>
              Project: {selectedProject?.name ?? "-"}
            </div>
            <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>
              Policy: {selectedPolicy?.name ?? "-"}
              {selectedPolicy?.runtimeLeaseMinutes
                ? ` · ${selectedPolicy.runtimeLeaseMinutes} minute runtime lease`
                : ""}
            </div>
            <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>
              Allowed Regions:{" "}
              {selectedAllowedRegions.length > 0
                ? selectedAllowedRegions.map((region) => region.friendlyName ?? region.name).join(", ")
                : "-"}
            </div>
            <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>
              Snapshot: {defaultSnapshot ? `${defaultSnapshot.name} (default only for Experience launches)` : "-"}
            </div>
            {blueprintSummary && (
              <div style={{ color: "#444", fontSize: "0.9rem", overflowWrap: "anywhere" }}>
                Blueprint: {blueprintSummary}
              </div>
            )}
          </div>

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
                Time limit follows the selected CloudShare Policy runtime lease for this slice.
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
              <button onClick={() => resetExamForm()} disabled={loading} style={{ padding: "0.7rem 1rem" }}>
                Cancel Edit
              </button>
            )}
            {examMessage && <span style={{ color: "#0a7a28" }}>{examMessage}</span>}
          </div>

          <div style={{ overflowX: "auto" }}>
            <h2 style={{ marginBottom: "0.6rem" }}>Current Exam Catalog</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Title", "Status", "Project", "Blueprint / Snapshot", "Allowed Regions", "Policy", "Score", "Action"].map((heading) => (
                    <th key={heading} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {examCatalog.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: "0.5rem", color: "#666" }}>
                      No exams yet.
                    </td>
                  </tr>
                )}
                {examCatalog.map((exam) => (
                  <tr key={exam.id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                    <td style={{ padding: "0.4rem" }}>
                      <div style={{ fontWeight: 600 }}>{exam.title}</div>
                      <div style={{ color: "#666" }}>{exam.description}</div>
                    </td>
                    <td style={{ padding: "0.4rem" }}>
                      {exam.status}
                      {exam.publishedAt && (
                        <div style={{ color: "#666", fontSize: "0.75rem" }}>
                          {formatUtcTimestamp(exam.publishedAt)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{exam.projectName}</td>
                    <td style={{ padding: "0.4rem" }}>
                      <div>{exam.blueprintName}</div>
                      <div style={{ color: "#666", fontSize: "0.75rem" }}>{exam.snapshotName}</div>
                    </td>
                    <td style={{ padding: "0.4rem" }}>
                      {exam.allowedRegions.map((region) => region.name).join(", ")}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{exam.policyName}</td>
                    <td style={{ padding: "0.4rem" }}>{exam.scoreRetrievalEnabled ? "Enabled" : "Off"}</td>
                    <td style={{ padding: "0.4rem" }}>
                      {exam.status === "draft" ? (
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          {editingExamId === exam.id ? (
                            <span style={{ color: "#555", fontSize: "0.85rem" }}>
                              Editing - save or cancel before publishing.
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => void beginEditingExam(exam)}
                                disabled={loading || editingExamId !== null}
                                style={{ padding: "0.45rem 0.75rem" }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => void publishCatalogExam(exam.id)}
                                disabled={loading || editingExamId !== null}
                                style={{ padding: "0.45rem 0.75rem" }}
                              >
                                Publish
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => void unpublishCatalogExam(exam.id)}
                          disabled={loading || editingExamId !== null}
                          style={{ padding: "0.45rem 0.75rem" }}
                        >
                          Unpublish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
            <input
              placeholder="Filter by examAttemptId (optional)"
              value={examAttemptFilter}
              onChange={(e) => setExamAttemptFilter(e.target.value)}
              style={{ flex: 1, padding: "0.4rem" }}
            />
            <button onClick={loadAudit} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
          {auditRecords && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Time", "ExamAttempt", "Action", "Outcome", "Details / Error"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditRecords.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0.5rem", color: "#666" }}>
                      No records found
                    </td>
                  </tr>
                )}
                {auditRecords.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                      {formatUtcTimestamp(r.occurredAt)}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{r.examAttemptId}</td>
                    <td style={{ padding: "0.4rem" }}>{r.action}</td>
                    <td style={{ padding: "0.4rem", color: r.outcome === "success" ? "green" : "red", fontWeight: "bold" }}>
                      {r.outcome}
                    </td>
                    <td style={{ padding: "0.4rem", fontSize: "0.8rem", color: "#444" }}>
                      {r.error ?? (r.details ? JSON.stringify(r.details) : "-")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "monitoring" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <p style={{ margin: 0, color: "#555" }}>
              Current attempts are grouped by state. History shows terminal attempts and any stored result summary.
            </p>
            <button onClick={() => void loadMonitoring()} disabled={loading} style={{ padding: "0.45rem 0.9rem" }}>
              {loading ? "Loading..." : "Refresh Monitoring"}
            </button>
          </div>

          {monitoring && (
            <>
              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                {[
                  ["Scheduled", monitoring.summary.scheduled],
                  ["Ready", monitoring.summary.ready],
                  ["In progress", monitoring.summary.inProgress],
                  ["Suspended", monitoring.summary.suspended],
                  ["Completed", monitoring.summary.completed],
                  ["Expired", monitoring.summary.expired],
                ].map(([label, count]) => (
                  <div key={label} style={{ background: "#f7f7f8", borderRadius: "8px", padding: "0.9rem" }}>
                    <div style={{ color: "#555", fontSize: "0.85rem" }}>{label}</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{count}</div>
                  </div>
                ))}
              </div>

              {([
                ["Scheduled", monitoring.currentAttempts.scheduled],
                ["Ready", monitoring.currentAttempts.ready],
                ["In Progress", monitoring.currentAttempts.inProgress],
                ["Suspended", monitoring.currentAttempts.suspended],
              ] as const).map(([label, attempts]) =>
                renderAttemptCollection(label, attempts, "No current attempts in this state."),
              )}

              {renderAttemptCollection(
                "Completed / expired attempts",
                monitoring.history,
                "No completed or expired attempts yet.",
              )}
            </>
          )}
        </section>
      )}

      {tab === "events" && (
        <section>
          <button onClick={loadEvents} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
            {loading ? "Loading..." : "Load Event Log"}
          </button>
          {eventRecords && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Time", "Type", "Event ID", "Payload"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {eventRecords.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "0.5rem", color: "#666" }}>
                      No events recorded
                    </td>
                  </tr>
                )}
                {eventRecords.map((e, index) => (
                  <tr key={buildEventRecordRowKey(e, index)} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                      {formatUtcTimestamp(e.occurredAt)}
                    </td>
                    <td style={{ padding: "0.4rem" }}>{e.type}</td>
                    <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#666" }}>{e.eventId}</td>
                    <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#444" }}>
                      <pre style={{ margin: 0 }}>{JSON.stringify(e.payload, null, 0)}</pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "support" && (
        <section style={{ display: "grid", gap: "1rem" }}>
          <p style={{ color: "#555", marginTop: 0 }}>
            The Support Workbench groups current ExamAttempts into support queues and keeps the redacted CloudShare
            webhook diagnostics below. The full Session Monitoring tab remains available for the previous slice’s
            dedicated live monitoring view.
          </p>
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              alignItems: "end",
            }}
          >
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Candidate email or name</span>
              <input
                value={supportCandidateFilter}
                onChange={(event) => setSupportCandidateFilter(event.target.value)}
                placeholder="morgan.lee@helioscx.demo"
                style={{ padding: "0.5rem" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Exam</span>
              <select
                value={supportExamFilter}
                onChange={(event) => setSupportExamFilter(event.target.value)}
                style={{ padding: "0.5rem" }}
              >
                <option value="">All Exams</option>
                {examCatalog.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.title}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Attempt status</span>
              <select
                value={supportStatusFilter}
                onChange={(event) => setSupportStatusFilter(event.target.value)}
                style={{ padding: "0.5rem" }}
              >
                <option value="">All statuses</option>
                <option value="scheduled">Scheduled</option>
                <option value="ready">Ready</option>
                <option value="in_progress">In progress</option>
                <option value="suspended">Suspended</option>
                <option value="completed">Completed</option>
                <option value="expired">Expired</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Scheduled from (UTC)</span>
              <input
                type="datetime-local"
                value={supportScheduledFromFilter}
                onChange={(event) => setSupportScheduledFromFilter(event.target.value)}
                style={{ padding: "0.5rem" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Scheduled to (UTC)</span>
              <input
                type="datetime-local"
                value={supportScheduledToFilter}
                onChange={(event) => setSupportScheduledToFilter(event.target.value)}
                style={{ padding: "0.5rem" }}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Attempt limit</span>
              <input
                type="number"
                min={1}
                max={200}
                value={supportLimitFilter}
                onChange={(event) => setSupportLimitFilter(event.target.value)}
                style={{ padding: "0.5rem" }}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button onClick={onLoadSupportWorkbench} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              {loading ? "Loading..." : "Apply Workbench Filters"}
            </button>
            <button onClick={onResetSupportWorkbenchFilters} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              Reset Filters
            </button>
            <button onClick={onLoadSupportLog} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
              {loading ? "Loading..." : "Load Full Support Log"}
            </button>
          </div>
          {supportWorkbench && (
            <>
              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                {[
                  ["Scheduled", supportWorkbench.summary.scheduled],
                  ["Ready", supportWorkbench.summary.ready],
                  ["In progress", supportWorkbench.summary.inProgress],
                  ["Suspended", supportWorkbench.summary.suspended],
                  ["Completed", supportWorkbench.summary.completed],
                  ["Expired", supportWorkbench.summary.expired],
                ].map(([label, count]) => (
                  <div key={label} style={{ background: "#f7f7f8", borderRadius: "8px", padding: "0.9rem" }}>
                    <div style={{ color: "#555", fontSize: "0.85rem" }}>{label}</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{count}</div>
                  </div>
                ))}
              </div>

              <div style={{ color: "#555", fontSize: "0.9rem" }}>
                Showing {supportWorkbench.meta.returnedAttempts} of {supportWorkbench.meta.totalMatchingAttempts} matching attempts.
                {supportWorkbench.meta.defaultLimitApplied
                  ? ` Default limit ${supportWorkbench.meta.limit} applied.`
                  : ` Limit ${supportWorkbench.meta.limit}.`}
              </div>

              {([
                [
                  "Scheduled queue",
                  supportWorkbench.currentQueues.scheduled,
                  supportWorkbench.meta.currentQueueTotals.scheduled,
                ],
                [
                  "Ready queue",
                  supportWorkbench.currentQueues.ready,
                  supportWorkbench.meta.currentQueueTotals.ready,
                ],
                [
                  "In-progress queue",
                  supportWorkbench.currentQueues.inProgress,
                  supportWorkbench.meta.currentQueueTotals.inProgress,
                ],
                [
                  "Suspended queue",
                  supportWorkbench.currentQueues.suspended,
                  supportWorkbench.meta.currentQueueTotals.suspended,
                ],
              ] as const).map(([label, attempts, totalCount]) =>
                renderAttemptCollection(
                  label,
                  attempts,
                  "No matching attempts in this queue.",
                  totalCount,
                ),
              )}

              {renderAttemptCollection(
                "Matching attempts",
                supportWorkbench.matchingAttempts,
                "No ExamAttempts matched the current filters.",
              )}

              <div style={{ marginBottom: "0.5rem" }}>
                <h3 style={{ margin: "0 0 0.75rem" }}>Recent Webhook Diagnostics</h3>
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {supportWorkbench.diagnostics.length === 0 && (
                    <div style={{ color: "#666" }}>No recent CloudShare webhook diagnostics.</div>
                  )}
                  {supportWorkbench.diagnostics.map((diagnostic, index) => (
                    <div
                      key={`${diagnostic.timestamp}-${diagnostic.message}-${index}`}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        padding: "0.85rem 1rem",
                        background: "#fff",
                      }}
                    >
                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                        <strong>{diagnostic.message}</strong>
                        <span style={{ color: "#666" }}>{formatUtcTimestamp(diagnostic.timestamp)}</span>
                        <span style={{ textTransform: "uppercase", color: diagnostic.level === "warn" ? "#8a5a00" : "#555" }}>
                          {diagnostic.level}
                        </span>
                      </div>
                      <div style={{ display: "grid", gap: "0.25rem", fontSize: "0.85rem", color: "#444" }}>
                        <div>
                          <strong>Request:</strong>{" "}
                          <span style={{ fontFamily: "monospace" }}>
                            {diagnostic.method ?? "?"} {diagnostic.path ?? "?"}
                          </span>
                        </div>
                        <div>
                          <strong>Webhook token:</strong>{" "}
                          <span style={{ fontFamily: "monospace" }}>{diagnostic.webhookPathToken ?? "-"}</span>
                        </div>
                        <div>
                          <strong>Customer:</strong>{" "}
                          <span style={{ fontFamily: "monospace" }}>{diagnostic.customerId ?? "-"}</span>
                        </div>
                        <div>
                          <strong>Signature present:</strong>{" "}
                          {diagnostic.signaturePresent === null ? "-" : diagnostic.signaturePresent ? "yes" : "no"}
                        </div>
                        <div>
                          <strong>Body bytes:</strong> {diagnostic.requestBodyBytes ?? "-"}
                        </div>
                        <div>
                          <strong>Raw body SHA-256:</strong>{" "}
                          <span style={{ fontFamily: "monospace" }}>{diagnostic.rawBodySha256 ?? "-"}</span>
                        </div>
                        {diagnostic.trustGateReason && (
                          <div style={{ color: "#8a5a00" }}>
                            <strong>Trust gate:</strong> {diagnostic.trustGateReason}
                          </div>
                        )}
                        {diagnostic.rawRequestBody && (
                          <div>
                            <strong>Raw webhook request body used for HMAC:</strong>
                            <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                              {diagnostic.rawRequestBody}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {supportRecords && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ minWidth: "118rem", width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "17rem" }} />
                  <col style={{ width: "5rem" }} />
                  <col style={{ width: "14rem" }} />
                  <col style={{ width: "18rem" }} />
                  <col style={{ width: "8rem" }} />
                  <col style={{ width: "12rem" }} />
                  <col style={{ width: "44rem" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    {["Time (UTC)", "Level", "Operation", "Request", "Result", "Correlation ID", "Details"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {supportRecords.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "0.5rem", color: "#666" }}>
                        No support log records
                      </td>
                    </tr>
                  )}
                  {supportRecords.map((record, index) => {
                    const operation = readStringField(record.fields, "operation") ?? record.message;
                    const method = readStringField(record.fields, "method");
                    const path = readStringField(record.fields, "path");
                    const responseStatus = readNumberField(record.fields, "responseStatus");
                    const failureMode = readStringField(record.fields, "failureMode");
                    const correlationId = readStringField(record.fields, "correlationId");
                    const integrationSurface = readStringField(record.fields, "integrationSurface");
                    const host = readStringField(record.fields, "host");
                    const requestHeaders = record.fields.requestHeaders;
                    const requestBody = record.fields.requestBody;
                    const requestBodySummary = record.fields.requestBodySummary;
                    const rawRequestBody = record.fields.rawRequestBody;
                    const rawBodySha256 = readStringField(record.fields, "rawBodySha256");
                    const receivedSignature = readStringField(record.fields, "receivedSignature");
                    const expectedSignature = readStringField(record.fields, "expectedSignature");
                    const signatureMatched = record.fields.signatureMatched;
                    const signatureFailureHint = readStringField(record.fields, "signatureFailureHint");
                    const storedWebhookSecretLength = readNumberField(record.fields, "storedWebhookSecretLength");
                    const webhookFieldRows = getWebhookSupportFieldRows(record.fields);
                    const responseHeaders = record.fields.responseHeaders;
                    const responseBody = record.fields.responseBody;
                    const network = record.fields.network;
                    const tls = record.fields.tls;
                    const cause = readStringField(record.fields, "cause");
                    const errorMessage = readStringField(record.fields, "error");
                    const verifiedAt = readStringField(record.fields, "verifiedAt");

                    return (
                      <tr key={`${record.timestamp}-${record.message}-${index}`} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                        <td style={{ padding: "0.4rem", whiteSpace: "nowrap" }}>
                          {formatUtcTimestamp(record.timestamp)}
                        </td>
                        <td style={{ padding: "0.4rem", textTransform: "uppercase" }}>{record.level}</td>
                        <td style={{ padding: "0.4rem", overflowWrap: "anywhere" }}>
                          <div>{operation}</div>
                          {integrationSurface && (
                            <div style={{ color: "#666", fontSize: "0.75rem" }}>{integrationSurface}</div>
                          )}
                        </td>
                        <td style={{ padding: "0.4rem", fontFamily: "monospace", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                          {method ?? "?"} {host ? `${host}${path ?? ""}` : (path ?? "?")}
                        </td>
                        <td style={{ padding: "0.4rem", overflowWrap: "anywhere" }}>
                          {typeof responseStatus === "number" ? `HTTP ${responseStatus}` : failureMode ?? record.message}
                          {verifiedAt && (
                            <div style={{ color: "#666", fontSize: "0.75rem" }}>
                              Verified at {formatUtcTimestamp(verifiedAt)}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "0.4rem", fontFamily: "monospace", fontSize: "0.75rem", overflowWrap: "anywhere" }}>
                          {correlationId ?? "-"}
                        </td>
                        <td style={{ padding: "0.4rem", fontSize: "0.75rem", color: "#444", overflowWrap: "anywhere" }}>
                          <div style={{ display: "grid", gap: "0.35rem" }}>
                            <div>
                              <strong>Message:</strong> {record.message}
                            </div>
                          {errorMessage && (
                            <div>
                              <strong>Error:</strong> {errorMessage}
                            </div>
                          )}
                          {cause && (
                            <div>
                              <strong>Cause:</strong> {cause}
                            </div>
                          )}
                          {requestHeaders !== undefined && (
                            <div>
                              <strong>Request headers:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(requestHeaders)}
                              </pre>
                            </div>
                          )}
                          {requestBody !== undefined && (
                            <div>
                              <strong>Request body:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(requestBody)}
                              </pre>
                            </div>
                          )}
                          {webhookFieldRows.length > 0 && (
                            <div>
                              <strong>Webhook fields:</strong>
                              <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(12rem, 1fr)", columnGap: "0.75rem", rowGap: "0.2rem", margin: "0.2rem 0 0" }}>
                                {webhookFieldRows.map(({ label, value }) => (
                                  <div key={label} style={{ display: "contents" }}>
                                    <dt style={{ fontWeight: 600 }}>{label}</dt>
                                    <dd style={{ margin: 0, fontFamily: "monospace", overflowWrap: "anywhere" }}>
                                      {formatSupportValue(value)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                          {requestBodySummary !== undefined && (
                            <div>
                              <strong>Webhook request body summary:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(requestBodySummary)}
                              </pre>
                            </div>
                          )}
                          {typeof rawRequestBody === "string" && rawRequestBody.length > 0 && (
                            <div>
                              <strong>Raw webhook request body used for HMAC:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(rawRequestBody)}
                              </pre>
                            </div>
                          )}
                          {rawBodySha256 && (
                            <div>
                              <strong>Raw body SHA-256:</strong> <span style={{ fontFamily: "monospace" }}>{rawBodySha256}</span>
                            </div>
                          )}
                          {receivedSignature && (
                            <div>
                              <strong>Received x-cloudshare-signature:</strong> <span style={{ fontFamily: "monospace" }}>{receivedSignature}</span>
                            </div>
                          )}
                          {expectedSignature && (
                            <div>
                              <strong>Expected signature from stored secret:</strong> <span style={{ fontFamily: "monospace" }}>{expectedSignature}</span>
                            </div>
                          )}
                          {typeof storedWebhookSecretLength === "number" && (
                            <div>
                              <strong>Stored webhook secret length:</strong> {storedWebhookSecretLength} characters
                            </div>
                          )}
                          {typeof signatureMatched === "boolean" && (
                            <div>
                              <strong>Signature matched:</strong> {signatureMatched ? "yes" : "no"}
                            </div>
                          )}
                          {signatureFailureHint && (
                            <div style={{ color: "#8a5a00" }}>
                              <strong>Signature diagnostic:</strong> {signatureFailureHint}
                            </div>
                          )}
                          {responseBody !== undefined && (
                            <div>
                              <strong>Response body:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(responseBody)}
                              </pre>
                            </div>
                          )}
                          {responseHeaders !== undefined && (
                            <div>
                              <strong>Response headers:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(responseHeaders)}
                              </pre>
                            </div>
                          )}
                          {network !== undefined && (
                            <div>
                              <strong>Network:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(network)}
                              </pre>
                            </div>
                          )}
                          {tls !== undefined && (
                            <div>
                              <strong>TLS:</strong>
                              <pre style={{ margin: "0.2rem 0 0", whiteSpace: "pre-wrap" }}>
                                {formatSupportValue(tls)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "resources" && (
        <section>
          <p style={{ color: "#555", marginTop: 0 }}>
            Stopgap sync surface only. Slice 2 authoring should use the <strong>Exam Catalog</strong> tab above instead of treating every visible CloudShare resource as a global list.
          </p>
          <button onClick={syncResources} disabled={loading} style={{ padding: "0.4rem 1rem", marginBottom: "1rem" }}>
            {loading ? "Syncing..." : "Sync CloudShare Resources"}
          </button>
          {syncResult && (
            <div>
              <p>
                Synced <strong>{syncResult.synced}</strong> resource(s)
              </p>
              {Object.entries(syncResult.byType).map(([type, items]) => (
                <div key={type} style={{ marginBottom: "1rem" }}>
                  <h3 style={{ margin: "0 0 0.4rem" }}>{type}</h3>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ background: "#f5f5f5" }}>
                        {["Name", "CloudShare ID", "Synced At"].map((h) => (
                          <th key={h} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.cloudshareId} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "0.4rem" }}>{item.name}</td>
                          <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{item.cloudshareId}</td>
                          <td style={{ padding: "0.4rem" }}>
                            {formatUtcTimestamp(item.syncedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
