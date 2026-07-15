import type { SalesDemoSession } from "./sales-demo-session";

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
  readonly createdAt: string;
  readonly lifecycle: Exclude<SalesSessionLifecycle, "all" | "needs_attention">;
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
    const lifecycle = session.cloudShareSalesExperienceId === "unprovisioned"
      ? "provisioning" as const
      : session.start > wallClock(now, session.timeZone)
        ? "upcoming" as const
        : session.end <= wallClock(now, session.timeZone) ? "ended" as const : "in_progress" as const;
    return { id: session.id, opportunityId: session.opportunityId, itemId: session.itemId, type: session.type, start: session.start, end: session.end, timeZone: session.timeZone, salesProDisplayName: session.salesProDisplayName, createdAt: session.createdAt.toISOString(), lifecycle, needsAttention: lifecycle === "provisioning" };
  });
  return views.filter((session) => filter === "all" || (filter === "needs_attention" ? session.needsAttention : session.lifecycle === filter));
}

function wallClock(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
