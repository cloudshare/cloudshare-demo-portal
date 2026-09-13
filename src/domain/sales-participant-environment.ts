export type SalesParticipantEnvironmentObservation =
  | { readonly dimension: "cloudshare_environment"; readonly value: "Ready" | "Suspended" | "Archived" | "Deleted" | "Taking a Snapshot" | "Preparing" | "Creation Failed"; readonly source: "cloudshare_v3_environment"; readonly observedAt: string }
  | { readonly dimension: "cloudshare_environment"; readonly value: "Future allocation scheduled" | "Allocation scheduled (not running)" | "Ready" | "Suspended" | "Archived" | "Deleted" | "Publishing" | "Preparing" | "Creation Failed" | "In grace" | "Stopping" | "Editing networks"; readonly source: "cloudshare_v4_sales_participant_roster"; readonly observedAt: string }
  | { readonly dimension: "cloudshare_environment"; readonly value: null; readonly source: "not_assigned" | "not_observed"; };

const rosterEnvironmentValues = {
  FutureAllocationScheduled: "Future allocation scheduled",
  AllocationScheduledNoRun: "Allocation scheduled (not running)",
  Ready: "Ready",
  Suspended: "Suspended",
  Archived: "Archived",
  Deleted: "Deleted",
  Publishing: "Publishing",
  Preparing: "Preparing",
  CreationFailed: "Creation Failed",
  InGrace: "In grace",
  Stopping: "Stopping",
  EditingNetworks: "Editing networks",
} as const;
const rosterEnvironmentKeys = new Set(Object.keys(rosterEnvironmentValues));

export function isProjectableSalesParticipantRosterEnvironment(status: string | null | undefined): status is keyof typeof rosterEnvironmentValues {
  return typeof status === "string" && rosterEnvironmentKeys.has(status);
}

/** Exact documented v3 Environment statusCode display contract for Sales UI. */
export function projectSalesParticipantEnvironment(statusCode: number | null | undefined, observedAt?: Date): SalesParticipantEnvironmentObservation {
  const value = statusCode === 2 ? "Ready" : statusCode === 3 ? "Suspended" : statusCode === 4 ? "Archived" : statusCode === 5 ? "Deleted" : statusCode === 7 ? "Taking a Snapshot" : statusCode === 8 ? "Preparing" : statusCode === 9 ? "Creation Failed" : null;
  return value && observedAt ? { dimension: "cloudshare_environment", value, source: "cloudshare_v3_environment", observedAt: observedAt.toISOString() } : { dimension: "cloudshare_environment", value: null, source: statusCode === null || statusCode === undefined ? "not_assigned" : "not_observed" };
}

/** The documented v4 Sales participant roster reports a roster-associated
 * Environment state. Keep its source distinct from a separately labelled
 * current/listable v3 owner-and-Project observation. */
export function projectSalesParticipantRosterEnvironment(status: keyof typeof rosterEnvironmentValues, observedAt: Date): SalesParticipantEnvironmentObservation {
  return { dimension: "cloudshare_environment", value: rosterEnvironmentValues[status], source: "cloudshare_v4_sales_participant_roster", observedAt: observedAt.toISOString() };
}
