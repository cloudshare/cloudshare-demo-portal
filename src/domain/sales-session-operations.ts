import type { SalesDemoSession } from "./sales-demo-session";
import { isSalesSessionVerificationEligible } from "./sales-session-verification";
import { projectSalesSessionStatus, type CertalisSalesSessionOperation, type CloudShareSalesExperienceStatus } from "./sales-session-status";

export type SalesSessionStatusFilter = {
  readonly operation?: CertalisSalesSessionOperation;
  readonly experience?: CloudShareSalesExperienceStatus;
};

export interface OperationalSalesSession {
  readonly id: string;
  readonly opportunityId: string;
  readonly itemId: string;
  readonly type: SalesDemoSession["type"];
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
  readonly salesProDisplayName: string;
  readonly sessionName: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly operation: { readonly dimension: "certalis_operation"; readonly value: CertalisSalesSessionOperation; readonly source: "certalis_persistence"; readonly reason?: string; readonly retry: "in_progress" | "not_applicable" | "unsafe_requires_support" };
  readonly experience: { readonly dimension: "cloudshare_sales_experience"; readonly value: CloudShareSalesExperienceStatus; readonly source: "cloudshare_v4_get_sales" | "schedule_prediction"; readonly freshness: "fresh" | "predicted"; readonly observedAt?: string };
  /** @deprecated legacy compatibility projection; clients must use operation/experience. */
  readonly lifecycle: "upcoming" | "in_progress" | "ended" | "provisioning" | "needs_attention";
  /** Verification is a safe read only for a persisted, active provider correlation. */
  readonly verificationEligible: boolean;
}

/** The Operations read-model seam. It deliberately derives lifecycle from the
 * persisted portal correlation so refreshing a browser never depends on a
 * transient Opportunity selection. */
export function buildOperationalSalesSessions(
  sessions: readonly SalesDemoSession[],
  now: Date,
  filter: SalesSessionStatusFilter = {},
): readonly OperationalSalesSession[] {
  const views = sessions.map((session) => {
    const status = projectSalesSessionStatus(session.cloudShareSalesExperienceId === "unprovisioned" ? { ...session, operationalStatus: "provisioning" } : session, now);
    const lifecycle = status.operation.value === "needs_attention" ? "needs_attention" as const : status.operation.value === "provisioning" ? "provisioning" as const : status.experience.value === "notStarted" ? "upcoming" as const : status.experience.value === "inProgress" ? "in_progress" as const : "ended" as const;
    return { id: session.id, opportunityId: session.opportunityId, itemId: session.itemId, type: session.type, start: session.start, end: session.end, timeZone: session.timeZone, salesProDisplayName: session.salesProDisplayName, sessionName: session.sessionName ?? "Sales Enablement Session", revision: session.revision ?? 1, createdAt: session.createdAt.toISOString(), operation: status.operation, experience: status.experience, lifecycle, verificationEligible: isSalesSessionVerificationEligible(session) };
  });
  return views.filter((session) => (!filter.operation || session.operation.value === filter.operation) && (!filter.experience || session.experience.value === filter.experience));
}
