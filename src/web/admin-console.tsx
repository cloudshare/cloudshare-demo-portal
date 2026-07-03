"use client";

import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_TABS,
  ADMIN_SESSION_EXPIRED_MESSAGE,
  type AdminTab,
  beginLatestOnlyRequest,
  buildAdminConsoleHref,
  buildCorrelationDiagnosticsNavigation,
  buildMonitoringHistoryQueryString,
  buildExamAttemptDiagnosticsNavigation,
  buildDiagnosticLogQueryString,
  buildWebhookCallbackUrl,
  buildEventRecordRowKey,
  type DiagnosticLogFilters,
  getAdminTabLabel,
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
} from "./admin-console-state";
import {
  DiagnosticLogTable,
  type DiagnosticLogTableEntry as DiagnosticLogEntry,
} from "./diagnostic-log-table";
import { EventLogTable } from "./event-log-table";
import { SessionMonitoringPanel } from "./session-monitoring-panel";
import type { AdminMonitoringView as MonitoringView } from "@/domain/admin-monitoring";
import { startPortalSessionWatchdog } from "./session-expiry";
import { pageShellStyle } from "./page-shell";
import { mutedPanelStyle, alertPanelStyle } from "./card-styles";
import { primaryButtonStyle, secondaryButtonStyle } from "./button-styles";
import { colors, pageHeadingStyle } from "./design-tokens";

interface AdminConsoleProps {
  readonly email: string;
  readonly initialTab?: AdminTab;
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

class AdminSessionExpiredError extends Error {
  constructor() {
    super(ADMIN_SESSION_EXPIRED_MESSAGE);
    this.name = "AdminSessionExpiredError";
  }
}

const DIAGNOSTIC_PAGE_LIMIT = 50;
const SUPPORT_WORKFLOW_TABS = new Set<AdminTab>(["monitoring", "diagnostics"]);

function isAdminSessionExpiredError(error: unknown): error is AdminSessionExpiredError {
  return error instanceof AdminSessionExpiredError;
}

export function AdminConsole({
  email,
  initialTab = "connection",
  initialDiagnosticFilters = {},
}: AdminConsoleProps) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>(initialTab);
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
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [examCatalog, setExamCatalog] = useState<ExamRecord[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringView | null>(null);
  const [examMessage, setExamMessage] = useState<string | null>(null);
  const [examFormFeedback, setExamFormFeedback] = useState<string | null>(null);
  const [examDiagnostic, setExamDiagnostic] = useState<ConnectionDiagnostic | null>(null);
  const [examCorrelationId, setExamCorrelationId] = useState<string | null>(null);
  const projectResourcesRequestIdRef = useRef(0);
  const blueprintDetailRequestIdRef = useRef(0);
  const [examAttemptFilter, setExamAttemptFilter] = useState("");
  const [auditRecords, setAuditRecords] = useState<AuditRecord[] | null>(null);
  const [eventRecords, setEventRecords] = useState<EventLogRecord[] | null>(null);
  const [diagnosticEntries, setDiagnosticEntries] = useState<DiagnosticLogEntry[] | null>(null);
  const [diagnosticFilters, setDiagnosticFilters] = useState<DiagnosticLogFilters>(initialDiagnosticFilters);
  const [diagnosticPage, setDiagnosticPage] = useState<DiagnosticLogPageResponse | null>(null);
  const [expandedDiagnosticId, setExpandedDiagnosticId] = useState<string | null>(null);
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
    router.push(navigation.href);
    setDiagnosticFilters(navigation.filters);
    setExpandedDiagnosticId(null);
    setTab(navigation.tab);
    if (tab === "diagnostics") {
      void loadDiagnostics(false, navigation.pageOffset, navigation.filters);
    }
  }

  function openCorrelationSupportDiagnostics(correlationId: string) {
    const navigation = buildCorrelationDiagnosticsNavigation(correlationId);
    router.push(navigation.href);
    setDiagnosticFilters(navigation.filters);
    setExpandedDiagnosticId(null);
    setTab(navigation.tab);
    if (tab === "diagnostics") {
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
    router.push(
      buildAdminConsoleHref({
        tab: "diagnostics",
        diagnosticFilters,
      }),
    );
    void loadDiagnostics(false, 0);
  }

  function clearDiagnosticFilters() {
    const clearedFilters: DiagnosticLogFilters = {};
    router.push(
      buildAdminConsoleHref({
        tab: "diagnostics",
        diagnosticFilters: clearedFilters,
      }),
    );
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

  function resetExamForm(next?: {
    title?: string;
    description?: string;
    scoreRetrievalEnabled?: boolean;
    timeLimitMinutes?: string;
    openPeriodMinutes?: string;
  }) {
    setEditingExamId(null);
    setExamMessage(null);
    setExamFormFeedback(null);
    setExamTitle(next?.title ?? blueprintDetail?.name ?? "");
    setExamDescription(next?.description ?? stripHtmlToText(blueprintDetail?.description) ?? "");
    setScoreRetrievalEnabled(next?.scoreRetrievalEnabled ?? false);
    setTimeLimitMinutes(next?.timeLimitMinutes ?? "");
    setOpenPeriodMinutes(
      getResetOpenPeriodMinutes({
        explicitOpenPeriodMinutes: next?.openPeriodMinutes,
        selectedPolicy,
        fallbackRuntimeLeaseMinutes: timeLimitMinutes,
      }),
    );
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
        void loadBlueprintDetail(projectId, blueprintId, refresh, nextPolicy);
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
    if (!editingExamId) {
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
      if (!editingExamId && detail) {
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
      setOpenPeriodMinutes(String(exam.openPeriodMinutes));
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
      <h1 style={{ ...pageHeadingStyle, marginBottom: "0.35rem" }}>Certalis Admin Console</h1>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "#555" }}>Signed in as {email}</p>
        <button onClick={logout} disabled={loading} style={secondaryButtonStyle}>
          Log out
        </button>
      </div>
      <nav
        aria-label="Admin console sections"
        style={{ display: "flex", gap: "0.75rem", marginBottom: "0.85rem", flexWrap: "wrap" }}
      >
        {ADMIN_TABS.map((t) => {
          const isActive = tab === t;
          const isSupportWorkflow = SUPPORT_WORKFLOW_TABS.has(t);

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
                router.push(
                  buildAdminConsoleHref({
                    tab: t,
                    diagnosticFilters,
                  }),
                );
                setTab(t);
              }}
              style={{
                padding: "0.55rem 0.95rem",
                background: isActive ? colors.textPrimary : isSupportWorkflow ? colors.accentSoft : "#f3f4f6",
                color: isActive ? "#fff" : "#111827",
                border: isActive ? `2px solid ${colors.accent}` : "1px solid #d1d5db",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: isActive ? 700 : 600,
                boxShadow: isActive ? "0 0 0 3px rgba(37, 99, 235, 0.18)" : "none",
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
              <button onClick={() => void createCandidate()} disabled={loading} style={primaryButtonStyle}>
                Create Candidate
              </button>
              {candidateMessage && <span style={{ color: "#0a7a28" }}>{candidateMessage}</span>}
            </div>
          </div>
        </section>
      )}

      {tab === "connection" && (
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
              {selectedPolicy?.storageLeaseMinutes
                ? ` · ${selectedPolicy.storageLeaseMinutes} minute storage retention`
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

          <div style={{ overflowX: "auto" }}>
            <h2 style={{ marginBottom: "0.6rem" }}>Current Exam Catalog</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  {["Title", "Status", "Project", "Blueprint / Snapshot", "Allowed Regions", "Policy", "Duration", "Score", "Action"].map((heading) => (
                    <th key={heading} style={{ textAlign: "left", padding: "0.4rem", borderBottom: "1px solid #ddd" }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {examCatalog.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: "0.5rem", color: "#666" }}>
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
                    <td style={{ padding: "0.4rem" }}>
                      <div>{exam.timeLimitMinutes} min runtime</div>
                      <div style={{ color: "#666", fontSize: "0.75rem" }}>
                        {exam.openPeriodMinutes} min open
                      </div>
                      {exam.storageLeaseMinutes ? (
                        <div style={{ color: "#666", fontSize: "0.75rem" }}>
                          {exam.storageLeaseMinutes} min storage
                        </div>
                      ) : null}
                    </td>
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
              <p style={{ color: "#555", margin: "0.35rem 0 0" }}>
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
