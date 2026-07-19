export type SalesParticipantEnvironmentObservation =
  | { readonly dimension: "cloudshare_environment"; readonly value: "Ready" | "Suspended" | "Archived" | "Deleted" | "Taking a Snapshot" | "Preparing" | "Creation Failed"; readonly source: "cloudshare_v3_environment"; readonly observedAt: string }
  | { readonly dimension: "cloudshare_environment"; readonly value: "Ready" | "Suspended" | "Archived" | "Deleted" | "Preparing" | "Creation Failed" | null; readonly source: "cloudshare_v4_sales_participant_roster"; readonly observedAt: string }
  | { readonly dimension: "cloudshare_environment"; readonly value: null; readonly source: "not_assigned" | "not_observed"; };

/** Exact documented v3 Environment statusCode display contract for Sales UI. */
export function projectSalesParticipantEnvironment(statusCode: number | null | undefined, observedAt?: Date): SalesParticipantEnvironmentObservation {
  const value = statusCode === 2 ? "Ready" : statusCode === 3 ? "Suspended" : statusCode === 4 ? "Archived" : statusCode === 5 ? "Deleted" : statusCode === 7 ? "Taking a Snapshot" : statusCode === 8 ? "Preparing" : statusCode === 9 ? "Creation Failed" : null;
  return value && observedAt ? { dimension: "cloudshare_environment", value, source: "cloudshare_v3_environment", observedAt: observedAt.toISOString() } : { dimension: "cloudshare_environment", value: null, source: statusCode === null || statusCode === undefined ? "not_assigned" : "not_observed" };
}

/** The documented v4 Sales participant roster reports the most recent
 * Environment state, including terminal environments which v3's active list
 * deliberately omits. Keep its source distinct from a v3 observation. */
export function projectSalesParticipantRosterEnvironment(status: string, observedAt: Date): SalesParticipantEnvironmentObservation {
  const value = status === "Ready" ? "Ready" : status === "Suspended" ? "Suspended" : status === "Archived" ? "Archived" : status === "Deleted" ? "Deleted" : status === "Preparing" ? "Preparing" : status === "CreationFailed" ? "Creation Failed" : null;
  return { dimension: "cloudshare_environment", value, source: "cloudshare_v4_sales_participant_roster", observedAt: observedAt.toISOString() };
}
