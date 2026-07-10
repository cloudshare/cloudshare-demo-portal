import type {
  CohortMonitoringObservation,
  CohortMonitoringObservationRepository,
} from "@/domain/cohort-monitoring-observation";

export function createInMemoryCohortMonitoringObservationRepository(): CohortMonitoringObservationRepository {
  const observations = new Map<string, CohortMonitoringObservation>();
  return {
    async record(input) {
      const key = `${input.customerId}:${input.cohortSessionId}:${input.rowKey}`;
      const previous = observations.get(key);
      const next: CohortMonitoringObservation = {
        ...input,
        consecutiveReads: previous?.signature === input.signature ? previous.consecutiveReads + 1 : 1,
      };
      observations.set(key, next);
      return next;
    },
  };
}
