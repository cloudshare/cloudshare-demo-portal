import type { SalesDemoSession } from "./sales-demo-session";
import { cloudShareWallClockToInstant } from "./cloudshare-wall-clock";

export type SalesSessionLifecycle = "all" | "upcoming" | "in_progress" | "ended" | "provisioning" | "needs_attention";

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
  readonly lifecycle: Exclude<SalesSessionLifecycle, "all">;
  readonly needsAttention: boolean;
}

/** The Operations read-model seam. It deliberately derives lifecycle from the
 * persisted portal correlation so refreshing a browser never depends on a
 * transient Opportunity selection. */
export function buildOperationalSalesSessions(
  sessions: readonly SalesDemoSession[],
  now: Date,
  filter: SalesSessionLifecycle = "all",
): readonly OperationalSalesSession[] {
  const views = sessions.map((session) => {
    const start = cloudShareWallClockToInstant(session.start, session.timeZone);
    const end = cloudShareWallClockToInstant(session.end, session.timeZone);
    const lifecycle = session.operationalStatus === "needs_attention"
      ? "needs_attention" as const
      : session.operationalStatus === "provisioning" || session.cloudShareSalesExperienceId === "unprovisioned"
      ? "provisioning" as const
      : !start || !end ? "needs_attention" as const
      : start > now
        ? "upcoming" as const
        : end <= now ? "ended" as const : "in_progress" as const;
    return { id: session.id, opportunityId: session.opportunityId, itemId: session.itemId, type: session.type, start: session.start, end: session.end, timeZone: session.timeZone, salesProDisplayName: session.salesProDisplayName, sessionName: session.sessionName ?? "Sales Enablement Session", revision: session.revision ?? 1, createdAt: session.createdAt.toISOString(), lifecycle, needsAttention: lifecycle === "needs_attention" };
  });
  return views.filter((session) => filter === "all" || session.lifecycle === filter);
}
