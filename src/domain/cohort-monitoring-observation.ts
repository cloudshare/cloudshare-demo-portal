/**
 * Durable state for a Cohort Exam Session reconciliation signal.  The monitor
 * deliberately requires the same signal on two consecutive CloudShare reads
 * before it asks an administrator to intervene.
 */
export interface CohortMonitoringObservation {
  readonly customerId: string;
  readonly cohortSessionId: string;
  readonly rowKey: string;
  readonly signature: string;
  readonly consecutiveReads: number;
  readonly observedAt: Date;
}

export interface CohortMonitoringObservationRepository {
  record(input: Omit<CohortMonitoringObservation, "consecutiveReads">): Promise<CohortMonitoringObservation>;
}

export function classifyCohortMonitoringObservation(
  observation: CohortMonitoringObservation | null,
): "normal" | "state_observation" | "needs_attention" {
  if (!observation) return "normal";
  return observation.consecutiveReads >= 2 ? "needs_attention" : "state_observation";
}
