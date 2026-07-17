import type { SalesDemoSession } from "./sales-demo-session";

/** CloudShare verification is a read only for an active Session with a real provider ID. */
export function isSalesSessionVerificationEligible(session: Pick<SalesDemoSession, "operationalStatus" | "cloudShareSalesExperienceId">): boolean {
  return session.operationalStatus === "active" && session.cloudShareSalesExperienceId !== "unprovisioned" && !session.cloudShareSalesExperienceId.startsWith("pending:");
}
