import { cloudShareWallClockToInstant } from "./cloudshare-wall-clock";

export type CertalisSalesSessionOperation = "provisioning" | "correlated" | "needs_attention";
export type CloudShareSalesExperienceStatus = "notStarted" | "inProgress" | "ended";
export const SALES_EXPERIENCE_OBSERVATION_FRESHNESS_MS = 5 * 60 * 1000;

export type SalesSessionStatusInput = {
  readonly operationalStatus?: "provisioning" | "active" | "needs_attention";
  readonly attentionReason?: string | null;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly experienceStatus?: CloudShareSalesExperienceStatus | null;
  readonly experienceStatusObservedAt?: Date | null;
  readonly experienceStatusSource?: string | null;
};

export function projectSalesSessionStatus(session: SalesSessionStatusInput, now: Date) {
  const operation = session.operationalStatus === "needs_attention"
    ? { dimension: "certalis_operation" as const, value: "needs_attention" as const, source: "certalis_persistence" as const, reason: session.attentionReason ?? "Certalis requires support before this operation can continue.", retry: "unsafe_requires_support" as const }
    : session.operationalStatus === "provisioning"
      ? { dimension: "certalis_operation" as const, value: "provisioning" as const, source: "certalis_persistence" as const, retry: "in_progress" as const }
      : { dimension: "certalis_operation" as const, value: "correlated" as const, source: "certalis_persistence" as const, retry: "not_applicable" as const };
  const observationSource: "cloudshare_v4_sales_list" | "cloudshare_v4_get_sales" | null = session.experienceStatusSource === "cloudshare_v4_sales_list" || session.experienceStatusSource === "cloudshare_v4_get_sales" ? session.experienceStatusSource : session.experienceStatus && session.experienceStatusObservedAt ? "cloudshare_v4_get_sales" : null;
  if (session.experienceStatus && session.experienceStatusObservedAt && observationSource && now.getTime() - session.experienceStatusObservedAt.getTime() <= SALES_EXPERIENCE_OBSERVATION_FRESHNESS_MS) return { operation, experience: { dimension: "cloudshare_sales_experience" as const, value: session.experienceStatus, source: observationSource, freshness: "fresh" as const, observedAt: session.experienceStatusObservedAt.toISOString() } };
  const start = cloudShareWallClockToInstant(session.start, session.timeZone);
  const end = cloudShareWallClockToInstant(session.end, session.timeZone);
  const value: CloudShareSalesExperienceStatus = !start || !end || start > now ? "notStarted" : end <= now ? "ended" : "inProgress";
  return { operation, experience: { dimension: "cloudshare_sales_experience" as const, value, source: "schedule_prediction" as const, freshness: "predicted" as const } };
}
