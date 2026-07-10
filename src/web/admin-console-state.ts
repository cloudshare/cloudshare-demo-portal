import type { AdminMonitoringView } from "@/domain/admin-monitoring";
import { isPortalSessionExpiredStatus } from "./session-expiry";

export interface ExamAuthoringMode {
  readonly isEditingDraft: boolean;
  readonly provisioningLocked: boolean;
  readonly tupleChangeHint: string | null;
}

export interface DiagnosticLogFilters {
  readonly examAttemptId?: string;
  readonly examId?: string;
  readonly candidateEmail?: string;
  readonly operation?: string;
  readonly outcome?: "success" | "failure";
  readonly source?: string;
  readonly integrationSurface?: string;
  readonly correlationId?: string;
  readonly externalId?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface DiagnosticLogPage {
  readonly limit: number;
  readonly offset: number;
}

export interface ExamAttemptDiagnosticsNavigation {
  readonly tab: "support";
  readonly supportView: "diagnostics";
  readonly filters: DiagnosticLogFilters;
  readonly pageOffset: 0;
  readonly href: string;
}

export interface CorrelationDiagnosticsNavigation {
  readonly tab: "support";
  readonly supportView: "diagnostics";
  readonly filters: DiagnosticLogFilters;
  readonly pageOffset: 0;
  readonly href: string;
}

export interface AdminConsoleRouteState {
  readonly tab: AdminTab;
  readonly examView: AdminExamView;
  readonly examId?: string;
  readonly cohortSessionId?: string;
  readonly supportView: AdminSupportView;
  readonly diagnosticFilters: DiagnosticLogFilters;
}

export type AdminTab =
  | "exams"
  | "candidates"
  | "support"
  | "configuration";

export const ADMIN_TABS: readonly AdminTab[] = [
  "exams",
  "candidates",
  "support",
  "configuration",
];

export type AdminExamView = "catalog" | "create" | "edit" | "sessions" | "session";
export type AdminSupportView = "monitoring" | "diagnostics" | "audit";

export const ADMIN_SESSION_EXPIRED_MESSAGE =
  "Your admin session has expired. Sign in again to continue.";

export function isAdminSessionExpiredStatus(status: number): boolean {
  return isPortalSessionExpiredStatus(status);
}

interface NamedResource {
  readonly id: string;
  readonly name: string;
  readonly friendlyName?: string;
}

interface PolicyLeaseEvidence {
  readonly runtimeLeaseMinutes?: number | null;
  readonly storageLeaseMinutes?: number | null;
}

export function getDefaultOpenPeriodMinutes(policy: PolicyLeaseEvidence | null | undefined): string {
  if (!policy?.runtimeLeaseMinutes) {
    return "";
  }

  if (policy.storageLeaseMinutes && policy.storageLeaseMinutes < policy.runtimeLeaseMinutes) {
    return String(policy.storageLeaseMinutes);
  }

  return String(policy.runtimeLeaseMinutes);
}

export function getResetOpenPeriodMinutes(input: {
  readonly explicitOpenPeriodMinutes?: string;
  readonly selectedPolicy: PolicyLeaseEvidence | null | undefined;
  readonly fallbackRuntimeLeaseMinutes?: string | number | null;
}): string {
  if (input.explicitOpenPeriodMinutes !== undefined) {
    return input.explicitOpenPeriodMinutes;
  }

  const policyDefault = getDefaultOpenPeriodMinutes(input.selectedPolicy);
  if (policyDefault) {
    return policyDefault;
  }

  const fallbackRuntimeLeaseMinutes = Number(input.fallbackRuntimeLeaseMinutes);
  return Number.isFinite(fallbackRuntimeLeaseMinutes) && fallbackRuntimeLeaseMinutes > 0
    ? String(fallbackRuntimeLeaseMinutes)
    : "";
}

interface BlueprintSnapshot {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly regionIds: readonly string[];
}

export function beginLatestOnlyRequest(activeRequestId: number): number {
  return activeRequestId + 1;
}

export function isLatestOnlyResponse(activeRequestId: number, responseRequestId: number): boolean {
  return activeRequestId === responseRequestId;
}

export function getAdminTabLabel(tab: AdminTab): string {
  switch (tab) {
    case "exams":
      return "Exams";
    case "candidates":
      return "Candidates";
    case "support":
      return "Support";
    case "configuration":
      return "Configuration";
  }
}

export function getAdminSupportViewLabel(view: AdminSupportView): string {
  switch (view) {
    case "monitoring":
      return "Session Monitoring";
    case "diagnostics":
      return "Support Diagnostics";
    case "audit":
      return "Audit Trail";
  }
}

export function shouldShowCandidateProvisioning(tab: AdminTab): boolean {
  return tab === "candidates";
}

export function shouldClearAdminBannerOnTabChange(from: AdminTab, to: AdminTab): boolean {
  return from !== to;
}

function normaliseOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normaliseDiagnosticLogFilters(
  filters: DiagnosticLogFilters,
): DiagnosticLogFilters {
  return {
    ...(normaliseOptionalText(filters.examAttemptId)
      ? { examAttemptId: normaliseOptionalText(filters.examAttemptId) }
      : {}),
    ...(normaliseOptionalText(filters.examId) ? { examId: normaliseOptionalText(filters.examId) } : {}),
    ...(normaliseOptionalText(filters.candidateEmail)
      ? { candidateEmail: normaliseOptionalText(filters.candidateEmail)?.toLowerCase() }
      : {}),
    ...(normaliseOptionalText(filters.operation)
      ? { operation: normaliseOptionalText(filters.operation) }
      : {}),
    ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(normaliseOptionalText(filters.source) ? { source: normaliseOptionalText(filters.source) } : {}),
    ...(normaliseOptionalText(filters.integrationSurface)
      ? { integrationSurface: normaliseOptionalText(filters.integrationSurface) }
      : {}),
    ...(normaliseOptionalText(filters.correlationId)
      ? { correlationId: normaliseOptionalText(filters.correlationId) }
      : {}),
    ...(normaliseOptionalText(filters.externalId)
      ? { externalId: normaliseOptionalText(filters.externalId) }
      : {}),
    ...(normaliseOptionalText(filters.from) ? { from: normaliseOptionalText(filters.from) } : {}),
    ...(normaliseOptionalText(filters.to) ? { to: normaliseOptionalText(filters.to) } : {}),
  };
}

export function buildDiagnosticLogQueryString(
  filters: DiagnosticLogFilters,
  page: DiagnosticLogPage,
): string {
  const params = new URLSearchParams();
  const normalised = normaliseDiagnosticLogFilters(filters);
  for (const [key, value] of Object.entries(normalised)) {
    if (value) {
      params.set(key, value);
    }
  }
  params.set("limit", String(page.limit));
  params.set("offset", String(page.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function buildMonitoringHistoryQueryString(page: DiagnosticLogPage): string {
  const params = new URLSearchParams();
  params.set("historyLimit", String(page.limit));
  params.set("historyOffset", String(page.offset));
  return `?${params.toString()}`;
}

export function mergeMonitoringHistoryPage(
  existing: AdminMonitoringView | null,
  next: AdminMonitoringView,
): AdminMonitoringView {
  if (!existing || next.historyPage.offset === 0) {
    return next;
  }

  const historyById = new Map(existing.history.map((attempt) => [attempt.id, attempt]));
  for (const attempt of next.history) {
    historyById.set(attempt.id, attempt);
  }

  return {
    ...next,
    history: [...historyById.values()],
  };
}

export function buildExamAttemptDiagnosticsNavigation(
  examAttemptId: string,
): ExamAttemptDiagnosticsNavigation {
  const nextFilters = {
    examAttemptId: examAttemptId.trim(),
  };

  return {
    tab: "support",
    supportView: "diagnostics",
    filters: nextFilters,
    pageOffset: 0,
    href: buildAdminConsoleHref({ tab: "support", supportView: "diagnostics", diagnosticFilters: nextFilters }),
  };
}

export function buildCorrelationDiagnosticsNavigation(
  correlationId: string,
): CorrelationDiagnosticsNavigation {
  const nextFilters = { correlationId: correlationId.trim() };

  return {
    tab: "support",
    supportView: "diagnostics",
    filters: nextFilters,
    pageOffset: 0,
    href: buildAdminConsoleHref({
      tab: "support",
      supportView: "diagnostics",
      diagnosticFilters: nextFilters,
    }),
  };
}

export function buildAdminConsoleHref(route: Partial<AdminConsoleRouteState> & { readonly tab: AdminTab }): string {
  const params = new URLSearchParams();
  params.set("tab", route.tab);

  if (route.tab === "exams" || route.tab === "support") {
    const examView = route.examView ?? "catalog";
    if (route.tab === "exams" && examView !== "catalog") {
      params.set("view", examView);
    }
    if (route.examId) {
      params.set("examId", route.examId);
    }
    if (route.cohortSessionId) {
      params.set("sessionId", route.cohortSessionId);
    }
  }

  if (route.tab === "support") {
    const supportView = route.supportView ?? "monitoring";
    if (supportView !== "monitoring") {
      params.set("view", supportView);
    }
  }

  if (route.tab === "support" && (route.supportView ?? "monitoring") === "diagnostics") {
    const filters = normaliseDiagnosticLogFilters(route.diagnosticFilters ?? {});
    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }
  }

  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

export function parseAdminConsoleRouteState(input: {
  readonly tab?: string | readonly string[];
  readonly view?: string | readonly string[];
  readonly examId?: string | readonly string[];
  readonly sessionId?: string | readonly string[];
  readonly examAttemptId?: string | readonly string[];
  readonly candidateEmail?: string | readonly string[];
  readonly operation?: string | readonly string[];
  readonly outcome?: string | readonly string[];
  readonly source?: string | readonly string[];
  readonly integrationSurface?: string | readonly string[];
  readonly correlationId?: string | readonly string[];
  readonly externalId?: string | readonly string[];
  readonly from?: string | readonly string[];
  readonly to?: string | readonly string[];
}): AdminConsoleRouteState {
  const { tab, supportView } = parseAdminTabWithSupportView(input.tab, input.view);
  const examView = tab === "exams" ? parseAdminExamView(input.view) : "catalog";
  const examId = tab === "exams" || tab === "support" ? readRouteValue(input.examId) : undefined;
  const cohortSessionId = tab === "exams" || tab === "support" ? readRouteValue(input.sessionId) : undefined;
  if (tab !== "support" || supportView !== "diagnostics") {
    return {
      tab,
      examView,
      ...(examId ? { examId } : {}),
      ...(cohortSessionId ? { cohortSessionId } : {}),
      supportView,
      diagnosticFilters: {},
    };
  }

  return {
    tab,
    examView,
    ...(examId ? { examId } : {}),
    ...(cohortSessionId ? { cohortSessionId } : {}),
    supportView,
    diagnosticFilters: normaliseDiagnosticLogFilters({
      examAttemptId: readRouteValue(input.examAttemptId),
      examId: readRouteValue(input.examId),
      candidateEmail: readRouteValue(input.candidateEmail),
      operation: readRouteValue(input.operation),
      outcome: parseOutcome(input.outcome),
      source: readRouteValue(input.source),
      integrationSurface: readRouteValue(input.integrationSurface),
      correlationId: readRouteValue(input.correlationId),
      externalId: readRouteValue(input.externalId),
      from: readRouteValue(input.from),
      to: readRouteValue(input.to),
    }),
  };
}

function readRouteValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function parseAdminTabWithSupportView(
  value: string | readonly string[] | undefined,
  view: string | readonly string[] | undefined,
): { tab: AdminTab; supportView: AdminSupportView } {
  const candidate = readRouteValue(value);
  if (candidate === "connection" || candidate === "configuration") {
    return { tab: "configuration", supportView: "monitoring" };
  }
  if (candidate === "monitoring" || candidate === "audit" || candidate === "diagnostics") {
    return { tab: "support", supportView: candidate };
  }
  if (candidate === "support") {
    return { tab: "support", supportView: parseAdminSupportView(view) };
  }
  if (candidate === "candidates") {
    return { tab: "candidates", supportView: "monitoring" };
  }
  return { tab: "exams", supportView: "monitoring" };
}

function parseAdminExamView(value: string | readonly string[] | undefined): AdminExamView {
  const candidate = readRouteValue(value);
  return candidate === "create" ||
    candidate === "edit" ||
    candidate === "sessions" ||
    candidate === "session"
    ? candidate
    : "catalog";
}

function parseAdminSupportView(value: string | readonly string[] | undefined): AdminSupportView {
  const candidate = readRouteValue(value);
  return candidate === "diagnostics" || candidate === "audit" ? candidate : "monitoring";
}

function parseOutcome(
  value: string | readonly string[] | undefined,
): DiagnosticLogFilters["outcome"] | undefined {
  const candidate = readRouteValue(value);
  return candidate === "success" || candidate === "failure" ? candidate : undefined;
}

export function buildWebhookCallbackUrl(
  publicBaseUrl: string,
  webhookPath: string | null | undefined,
): string | null {
  const trimmedBaseUrl = publicBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmedBaseUrl || !webhookPath) {
    return null;
  }

  return `${trimmedBaseUrl}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`;
}

export function getExamAuthoringMode(editingExamId: string | null): ExamAuthoringMode {
  if (!editingExamId) {
    return {
      isEditingDraft: false,
      provisioningLocked: false,
      tupleChangeHint: null,
    };
  }

  return {
    isEditingDraft: true,
    provisioningLocked: true,
    tupleChangeHint:
      "Project, Blueprint, and Snapshot are locked while editing a draft. Policy and allowed Regions can still be changed.",
  };
}

export function getCompatibleRegions(
  regions: readonly NamedResource[],
  defaultSnapshot: BlueprintSnapshot | null,
): NamedResource[] {
  if (!defaultSnapshot || defaultSnapshot.regionIds.length === 0) {
    return [];
  }

  return regions.filter((region) => defaultSnapshot.regionIds.includes(region.id));
}

export function reconcileAllowedRegionIds(
  selectedRegionIds: readonly string[],
  compatibleRegions: readonly NamedResource[],
): string[] {
  const compatibleRegionIds = new Set(compatibleRegions.map((region) => region.id));
  return selectedRegionIds.filter((regionId) => compatibleRegionIds.has(regionId));
}

export function shouldReconcileAllowedRegionIds(defaultSnapshot: BlueprintSnapshot | null): boolean {
  return defaultSnapshot !== null;
}

export function getAllowedRegionValidationMessage(
  selectedRegionIds: readonly string[],
  compatibleRegions: readonly NamedResource[],
): string | null {
  if (compatibleRegions.length === 0) {
    return "The selected Blueprint default Snapshot is not deployed to any Regions yet.";
  }

  if (selectedRegionIds.length === 0) {
    return "Select at least one allowed Region from the Blueprint default Snapshot.";
  }

  return null;
}
