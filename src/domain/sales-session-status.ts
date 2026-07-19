import { cloudShareWallClockToInstant } from "./cloudshare-wall-clock";

export type CertalisSalesSessionOperation = "provisioning" | "correlated" | "needs_attention";
export type CloudShareSalesExperienceStatus = "notStarted" | "inProgress" | "ended";

export type SalesSessionStatusInput = {
  readonly operationalStatus?: "provisioning" | "active" | "needs_attention";
  readonly attentionReason?: string | null;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly experienceStatus?: CloudShareSalesExperienceStatus | null;
  readonly experienceStatusObservedAt?: Date | null;
};

export function projectSalesSessionStatus(session: SalesSessionStatusInput, now: Date) {
  const operation = session.operationalStatus === "needs_attention"
    ? { dimension: "certalis_operation" as const, value: "needs_attention" as const, source: "certalis_persistence" as const, reason: session.attentionReason ?? "Certalis requires support before this operation can continue.", retry: "unsafe_requires_support" as const }
    : session.operationalStatus === "provisioning"
      ? { dimension: "certalis_operation" as const, value: "provisioning" as const, source: "certalis_persistence" as const, retry: "in_progress" as const }
      : { dimension: "certalis_operation" as const, value: "correlated" as const, source: "certalis_persistence" as const, retry: "not_applicable" as const };
  if (session.experienceStatus && session.experienceStatusObservedAt) return { operation, experience: { dimension: "cloudshare_sales_experience" as const, value: session.experienceStatus, source: "cloudshare_v4_get_sales" as const, freshness: "fresh" as const, observedAt: session.experienceStatusObservedAt.toISOString() } };
  const start = cloudShareWallClockToInstant(session.start, session.timeZone);
  const end = cloudShareWallClockToInstant(session.end, session.timeZone);
  const value: CloudShareSalesExperienceStatus = !start || !end || start > now ? "notStarted" : end <= now ? "ended" : "inProgress";
  return { operation, experience: { dimension: "cloudshare_sales_experience" as const, value, source: "schedule_prediction" as const, freshness: "predicted" as const } };
}
