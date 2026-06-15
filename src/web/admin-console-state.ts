export interface ExamAuthoringMode {
  readonly isEditingDraft: boolean;
  readonly provisioningLocked: boolean;
  readonly tupleChangeHint: string | null;
}

export type AdminTab =
  | "connection"
  | "exams"
  | "candidates"
  | "audit"
  | "events"
  | "support"
  | "resources";

export const ADMIN_TABS: readonly AdminTab[] = [
  "connection",
  "exams",
  "candidates",
  "audit",
  "events",
  "support",
  "resources",
];

export const ADMIN_SESSION_EXPIRED_MESSAGE =
  "Your admin session has expired. Sign in again to continue.";

export function isAdminSessionExpiredStatus(status: number): boolean {
  return status === 401;
}

interface NamedResource {
  readonly id: string;
  readonly name: string;
  readonly friendlyName?: string;
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
    case "connection":
      return "Connect CloudShare";
    case "exams":
      return "Exam Catalog";
    case "candidates":
      return "Candidates";
    case "audit":
      return "Audit Trail";
    case "events":
      return "Event Log";
    case "support":
      return "Support Log";
    case "resources":
      return "Resources";
  }
}

export function shouldShowCandidateProvisioning(tab: AdminTab): boolean {
  return tab === "candidates";
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
