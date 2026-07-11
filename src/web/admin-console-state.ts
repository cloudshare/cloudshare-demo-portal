import type { AdminMonitoringView } from "@/domain/admin-monitoring";
import {
  normaliseDiagnosticLogFilters,
  type AdminTab,
  type DiagnosticLogFilters,
} from "./admin-shell-route";

export type {
  AdminConsoleRouteState,
  AdminExamView,
  AdminSupportView,
  AdminTab,
  DiagnosticLogFilters,
} from "./admin-shell-route";

export interface ExamAuthoringMode {
  readonly isEditingDraft: boolean;
  readonly provisioningLocked: boolean;
  readonly tupleChangeHint: string | null;
}

export interface DiagnosticLogPage {
  readonly limit: number;
  readonly offset: number;
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

export function shouldShowCandidateProvisioning(tab: AdminTab): boolean {
  return tab === "candidates";
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
