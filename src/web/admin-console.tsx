"use client";

import React from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  ADMIN_SESSION_EXPIRED_MESSAGE,
  type AdminTab,
  beginLatestOnlyRequest,
  beginExamAttemptDiagnosticDrilldownRequest,
  buildDiagnosticLogQueryString,
  buildWebhookCallbackUrl,
  buildEventRecordRowKey,
  closeExamAttemptDiagnosticDrilldownRequest,
  type DiagnosticLogFilters,
  getAdminTabLabel,
  getAllowedRegionValidationMessage,
  getCompatibleRegions,
  getExamAuthoringMode,
  isAdminSessionExpiredStatus,
  isLatestOnlyResponse,
  normaliseDiagnosticLogFilters,
  reconcileAllowedRegionIds,
  shouldApplyExamAttemptDiagnosticDrilldownResponse,
  shouldClearAdminBannerOnTabChange,
  shouldShowCandidateProvisioning,
} from "./admin-console-state";
import {
  DiagnosticLogTable,
  type DiagnosticLogTableEntry as DiagnosticLogEntry,
} from "./diagnostic-log-table";
import { ExamAttemptDiagnosticDrilldown } from "./exam-attempt-diagnostic-drilldown";
import { EventLogTable } from "./event-log-table";
import { SupportLogTable } from "./support-log-table";
import type { ExamAttemptDiagnosticDrilldownReadModel } from "@/api/admin-exam-attempt-diagnostics";
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
  webhookPathFingerprint: string | null;
  method: string | null;
  path: string | null;
  requestBodyBytes: number | null;
  rawBodySha256: string | null;
  signaturePresent: boolean | null;
  trustGateReason: string | null;
}

interface DiagnosticLogPageResponse {
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface ExamAttemptDiagnosticDrilldownResponse {
  drilldown?: ExamAttemptDiagnosticDrilldownReadModel;
  error?: string;
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

class AdminSessionExpiredError extends Error {
  constructor() {
    super(ADMIN_SESSION_EXPIRED_MESSAGE);
    this.name = "AdminSessionExpiredError";
  }
}

const DIAGNOSTIC_PAGE_LIMIT = 50;

function isAdminSessionExpiredError(error: unknown): error is AdminSessionExpiredError {
  return error instanceof AdminSessionExpiredError;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
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
  const diagnosticDrilldownRequestRef = useRef({ requestId: 0, attemptId: null as string | null });
  const diagnosticDrilldownAbortControllerRef = useRef<AbortController | null>(null);
  const [examAttemptFilter, setExamAttemptFilter] = useState("");
  const [auditRecords, setAuditRecords] = useState<AuditRecord[] | null>(null);
  const [eventRecords, setEventRecords] = useState<EventLogRecord[] | null>(null);
  const [supportRecords, setSupportRecords] = useState<SupportLogRecord[] | null>(null);
  const [supportWorkbenchDiagnostics, setSupportWorkbenchDiagnostics] = useState<
    SupportWorkbenchDiagnostic[] | null
  >(null);
  const [diagnosticEntries, setDiagnosticEntries] = useState<DiagnosticLogEntry[] | null>(null);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>({});
  const [diagnosticPage, setDiagnosticPage] = useState<DiagnosticLogPageResponse | null>(null);
  const [expandedDiagnosticId, setExpandedDiagnosticId] = useState<string | null>(null);
  const [diagnosticDrilldown, setDiagnosticDrilldown] =
    useState<ExamAttemptDiagnosticDrilldownReadModel | null>(null);
  const [diagnosticDrilldownAttemptId, setDiagnosticDrilldownAttemptId] = useState<string | null>(null);
  const [diagnosticDrilldownLoading, setDiagnosticDrilldownLoading] = useState(false);
  const [diagnosticDrilldownError, setDiagnosticDrilldownError] = useState<string | null>(null);
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
    if (tab === "diagnostics") {
      void loadDiagnostics();
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

  async function openExamAttemptDiagnosticDrilldown(examAttemptId: string) {
    diagnosticDrilldownAbortControllerRef.current?.abort();
    const requestState = beginExamAttemptDiagnosticDrilldownRequest(
      diagnosticDrilldownRequestRef.current,
      examAttemptId,
    );
    diagnosticDrilldownRequestRef.current = requestState;
    const abortController = new AbortController();
    diagnosticDrilldownAbortControllerRef.current = abortController;
    setDiagnosticDrilldownAttemptId(examAttemptId);
    setDiagnosticDrilldown(null);
    setDiagnosticDrilldownLoading(true);
    setDiagnosticDrilldownError(null);
    try {
      const res = await fetchAdmin(
        `/api/admin/diagnostics/attempts/${encodeURIComponent(examAttemptId)}`,
        { signal: abortController.signal },
      );
      const data = (await res.json()) as ExamAttemptDiagnosticDrilldownResponse;
      if (
        !shouldApplyExamAttemptDiagnosticDrilldownResponse(diagnosticDrilldownRequestRef.current, {
          requestId: requestState.requestId,
          attemptId: examAttemptId,
        })
      ) {
        return;
      }
      if (!res.ok) {
        setDiagnosticDrilldown(null);
        setDiagnosticDrilldownError(data.error ?? "Failed to load ExamAttempt diagnostic drilldown");
        return;
      }
      setDiagnosticDrilldown(data.drilldown ?? null);
    } catch (caughtError) {
      if (isAbortError(caughtError)) {
        return;
      }
      if (isAdminSessionExpiredError(caughtError)) {
        return;
      }
      if (
        !shouldApplyExamAttemptDiagnosticDrilldownResponse(diagnosticDrilldownRequestRef.current, {
          requestId: requestState.requestId,
          attemptId: examAttemptId,
        })
      ) {
        return;
      }
      setDiagnosticDrilldown(null);
      setDiagnosticDrilldownError("Failed to load ExamAttempt diagnostic drilldown");
    } finally {
      if (
        shouldApplyExamAttemptDiagnosticDrilldownResponse(diagnosticDrilldownRequestRef.current, {
          requestId: requestState.requestId,
          attemptId: examAttemptId,
        })
      ) {
        diagnosticDrilldownAbortControllerRef.current = null;
        setDiagnosticDrilldownLoading(false);
      }
    }
  }

  function closeExamAttemptDiagnosticDrilldown() {
    diagnosticDrilldownAbortControllerRef.current?.abort();
    diagnosticDrilldownAbortControllerRef.current = null;
    diagnosticDrilldownRequestRef.current = closeExamAttemptDiagnosticDrilldownRequest(
      diagnosticDrilldownRequestRef.current,
    );
    setDiagnosticDrilldown(null);
    setDiagnosticDrilldownAttemptId(null);
    setDiagnosticDrilldownError(null);
    setDiagnosticDrilldownLoading(false);
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
      setSupportWorkbenchDiagnostics(null);
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

  async function loadSupportWorkbench(background = false) {
    if (!background) {
      setLoading(true);
      setError(null);
      setSupportRecords(null);
    }
    try {
      const res = await fetchAdmin("/api/admin/support-workbench");
      const data = await res.json() as {
        diagnostics?: SupportWorkbenchDiagnostic[];
        error?: string;
      };
      if (!res.ok) {
        if (!background) {
          setError(data.error ?? "Failed to load support workbench");
        }
        return;
      }
      setSupportWorkbenchDiagnostics(data.diagnostics ?? []);
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
    void loadDiagnostics(false, 0);
  }

  function clearDiagnosticFilters() {
    const clearedFilters: DiagnosticLogFilters = {};
    setDiagnosticFilters(clearedFilters);
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

  function onLoadSupportLog() {
    void loadSupportLog();
  }

  function onLoadSupportWorkbench() {
    void loadSupportWorkbench();
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
              ] as const).map(([label, attempts]) => (
                <div key={label} style={{ background: "#f7f7f8", borderRadius: "8px", padding: "1rem" }}>
                  <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                    {label} ({attempts.length})
                  </h2>
                  {attempts.length === 0 ? (
                    <p style={{ margin: 0, color: "#666" }}>No current attempts in this state.</p>
                  ) : (
                    <div style={{ display: "grid", gap: "0.75rem" }}>
                      {attempts.map((attempt) => (
                        <details key={attempt.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.75rem 0.9rem" }}>
                          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                            {attempt.candidateName} · {attempt.examTitle} · {formatAttemptStatus(attempt.status)}
                          </summary>
                          <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
                            <div>Candidate: {attempt.candidateEmail}</div>
                            <div>Scheduled (UTC): {formatUtcTimestamp(attempt.scheduledFor)}</div>
                            <div>Training ID: {attempt.trainingId ?? "-"}</div>
                            <div>Environment: {attempt.environmentExternalId ?? "-"}</div>
                            <div>
                              <button
                                type="button"
                                onClick={() => void openExamAttemptDiagnosticDrilldown(attempt.id)}
                                style={{ padding: "0.35rem 0.75rem" }}
                              >
                                Open support drilldown
                              </button>
                            </div>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                                <thead>
                                  <tr style={{ background: "#f5f5f5" }}>
                                    {["Time", "Kind", "Event", "Outcome", "Details"].map((heading) => (
                                      <th key={heading} style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #ddd" }}>
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
                                    <tr key={`${attempt.id}-${entry.occurredAt}-${entry.kind}-${index}`} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                                      <td style={{ padding: "0.35rem", whiteSpace: "nowrap" }}>
                                        {formatUtcTimestamp(entry.occurredAt)}
                                      </td>
                                      <td style={{ padding: "0.35rem" }}>{entry.kind}</td>
                                      <td style={{ padding: "0.35rem" }}>{entry.kind === "audit" ? entry.action : entry.eventType}</td>
                                      <td style={{ padding: "0.35rem" }}>
                                        {entry.kind === "audit"
                                          ? entry.outcome
                                          : (typeof entry.responseStatus === "number" ? `HTTP ${entry.responseStatus}` : entry.failureMode ?? "-")}
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
              ))}

              <div style={{ background: "#f7f7f8", borderRadius: "8px", padding: "1rem" }}>
                <h2 style={{ marginTop: 0, marginBottom: "0.75rem", fontSize: "1rem" }}>
                  Completed / expired attempts ({monitoring.history.length})
                </h2>
                {monitoring.history.length === 0 ? (
                  <p style={{ margin: 0, color: "#666" }}>No completed or expired attempts yet.</p>
                ) : (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {monitoring.history.map((attempt) => (
                      <details key={attempt.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "0.75rem 0.9rem" }}>
                        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                          {attempt.candidateName} · {attempt.examTitle} · {formatMonitoringResult(attempt.result)}
                        </summary>
                        <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.9rem" }}>
                          <div>Candidate: {attempt.candidateEmail}</div>
                          <div>Status: {formatAttemptStatus(attempt.status)}</div>
                          <div>Scheduled (UTC): {formatUtcTimestamp(attempt.scheduledFor)}</div>
                          <div>Training ID: {attempt.trainingId ?? "-"}</div>
                          <div>Environment: {attempt.environmentExternalId ?? "-"}</div>
                          <div>
                            <button
                              type="button"
                              onClick={() => void openExamAttemptDiagnosticDrilldown(attempt.id)}
                              style={{ padding: "0.35rem 0.75rem" }}
                            >
                              Open support drilldown
                            </button>
                          </div>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                              <thead>
                                <tr style={{ background: "#f5f5f5" }}>
                                  {["Time", "Kind", "Event", "Outcome", "Details"].map((heading) => (
                                    <th key={heading} style={{ textAlign: "left", padding: "0.35rem", borderBottom: "1px solid #ddd" }}>
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
                                  <tr key={`${attempt.id}-${entry.occurredAt}-${entry.kind}-${index}`} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
                                    <td style={{ padding: "0.35rem", whiteSpace: "nowrap" }}>
                                      {formatUtcTimestamp(entry.occurredAt)}
                                    </td>
                                    <td style={{ padding: "0.35rem" }}>{entry.kind}</td>
                                    <td style={{ padding: "0.35rem" }}>{entry.kind === "audit" ? entry.action : entry.eventType}</td>
                                    <td style={{ padding: "0.35rem" }}>
                                      {entry.kind === "audit"
                                        ? entry.outcome
                                        : (typeof entry.responseStatus === "number" ? `HTTP ${entry.responseStatus}` : entry.failureMode ?? "-")}
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
            <EventLogTable
              records={eventRecords}
              formatUtcTimestamp={formatUtcTimestamp}
              buildRowKey={buildEventRecordRowKey}
            />
          )}
        </section>
      )}

      {tab === "diagnostics" && (
        <section>
          <p style={{ color: "#555", marginTop: 0 }}>
            The correlated diagnostic log: what the portal did, in what order, and how to trace it.
            Entries are append-only and scoped to your Customer. This is the primary support workflow.
            Session Monitoring remains the current-state queue view. Timestamps are ISO 8601 in UTC.
            Secrets and credentials are redacted.
          </p>
          <div
            style={{
              display: "grid",
              gap: "0.75rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              marginBottom: "1rem",
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
              <span>Exam ID</span>
              <input
                value={diagnosticFilters.examId ?? ""}
                onChange={(event) => setDiagnosticFilter("examId", event.target.value)}
                placeholder="exam-123"
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
              <span>Correlation ID</span>
              <input
                value={diagnosticFilters.correlationId ?? ""}
                onChange={(event) => setDiagnosticFilter("correlationId", event.target.value)}
                placeholder="corr-123"
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
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
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
              <div style={{ color: "#555" }}>
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
          {diagnosticEntries && (
            <DiagnosticLogTable
              entries={diagnosticEntries}
              expandedDiagnosticId={expandedDiagnosticId}
              onToggleExpanded={(id) =>
                setExpandedDiagnosticId(expandedDiagnosticId === id ? null : id)
              }
              onOpenExamAttempt={(examAttemptId) => void openExamAttemptDiagnosticDrilldown(examAttemptId)}
            />
          )}
          {(diagnosticDrilldownAttemptId || diagnosticDrilldownLoading || diagnosticDrilldownError || diagnosticDrilldown) && (
            <ExamAttemptDiagnosticDrilldown
              drilldown={diagnosticDrilldown}
              loading={diagnosticDrilldownLoading}
              error={diagnosticDrilldownError}
              onClose={closeExamAttemptDiagnosticDrilldown}
            />
          )}
          <div style={{ marginTop: "2rem" }}>
            <h2 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>Legacy support traces</h2>
            <p style={{ color: "#555", marginTop: 0 }}>
              Older webhook trust-gate widgets and structured server logs remain available here as
              secondary evidence while support workflows move to the correlated Diagnostic Log above.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <button onClick={onLoadSupportWorkbench} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
                {loading ? "Loading..." : "Load Recent Webhook Diagnostics"}
              </button>
              <button onClick={onLoadSupportLog} disabled={loading} style={{ padding: "0.4rem 1rem" }}>
                {loading ? "Loading..." : "Load Full Support Log"}
              </button>
            </div>
          </div>
          {supportWorkbenchDiagnostics && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ margin: "0 0 0.75rem" }}>Recent Webhook Diagnostics</h3>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {supportWorkbenchDiagnostics.length === 0 && (
                  <div style={{ color: "#666" }}>No recent CloudShare webhook diagnostics.</div>
                )}
                {supportWorkbenchDiagnostics.map((diagnostic, index) => (
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
                        <span style={{ fontFamily: "monospace" }}>{diagnostic.webhookPathFingerprint ?? "-"}</span>
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {supportRecords && (
            <SupportLogTable
              records={supportRecords}
              formatUtcTimestamp={formatUtcTimestamp}
            />
          )}
        </section>
      )}

      {tab === "monitoring" &&
        (diagnosticDrilldownAttemptId || diagnosticDrilldownLoading || diagnosticDrilldownError || diagnosticDrilldown) && (
          <ExamAttemptDiagnosticDrilldown
            drilldown={diagnosticDrilldown}
            loading={diagnosticDrilldownLoading}
            error={diagnosticDrilldownError}
            onClose={closeExamAttemptDiagnosticDrilldown}
          />
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
