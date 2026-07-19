import type { SalesDemoSessionRepository } from "@/domain/sales-demo-session";

export const LOCAL_SALES_RESERVATION_FAILURE_SCENARIO = "sales-reservation-persistence-failure";
const firedTargets = new Set<string>();

/** Development-only, one-shot failure at the local reservation boundary.
 * The exact Customer + Opportunity allowlist keeps browser QA disposable and
 * guarantees the injected failure occurs before any CloudShare preflight. */
export function withLocalSalesReservationFailureQaFixture(
  repository: SalesDemoSessionRepository,
  env: NodeJS.ProcessEnv = process.env,
  fired: Set<string> = firedTargets,
): SalesDemoSessionRepository {
  const customerId = env.PORTAL_LOCAL_QA_SALES_CUSTOMER_ID?.trim();
  const opportunityId = env.PORTAL_LOCAL_QA_SALES_OPPORTUNITY_ID?.trim();
  const enabled = env.NODE_ENV === "development" && env.PORTAL_LOCAL_QA_SCENARIO === LOCAL_SALES_RESERVATION_FAILURE_SCENARIO && Boolean(customerId && opportunityId);
  const target = `${customerId}\u0000${opportunityId}`;
  return {
    ...repository,
    async save(session) {
      const matchesPendingReservation = enabled && session.customerId === customerId && session.opportunityId === opportunityId && session.operationalStatus === "provisioning" && session.cloudShareSalesExperienceId === `pending:${session.id}`;
      if (matchesPendingReservation && !fired.has(target)) {
        fired.add(target);
        throw new Error("Local QA fixture: injected Sales reservation persistence failure before CloudShare provisioning.");
      }
      return repository.save(session);
    },
  };
}
