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
    const lifecycle = session.operationalStatus === "needs_attention"
      ? "needs_attention" as const
      : session.operationalStatus === "provisioning" || session.cloudShareSalesExperienceId === "unprovisioned"
      ? "provisioning" as const
      : session.start > wallClock(now, session.timeZone)
        ? "upcoming" as const
        : session.end <= wallClock(now, session.timeZone) ? "ended" as const : "in_progress" as const;
    return { id: session.id, opportunityId: session.opportunityId, itemId: session.itemId, type: session.type, start: session.start, end: session.end, timeZone: session.timeZone, salesProDisplayName: session.salesProDisplayName, sessionName: session.sessionName ?? "Sales Enablement Session", revision: session.revision ?? 1, createdAt: session.createdAt.toISOString(), lifecycle, needsAttention: lifecycle === "needs_attention" };
  });
  return views.filter((session) => filter === "all" || session.lifecycle === filter);
}

function wallClock(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now); }
  catch { return now.toISOString().slice(0, 16); }
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
