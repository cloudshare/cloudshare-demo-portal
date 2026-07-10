import { describe, expect, it } from "vitest";
import { classifyCohortMonitoringObservation } from "@/domain/cohort-monitoring-observation";
import { createInMemoryCohortMonitoringObservationRepository } from "./cohort-monitoring-observation-repository";

describe("cohort monitoring observation repository", () => {
  it("keeps the first matching signal as an observation and escalates its second server-side read", async () => {
    const repository = createInMemoryCohortMonitoringObservationRepository();
    const input = { customerId: "customer-1", cohortSessionId: "session-1", rowKey: "attempt:1", signature: "runtime mismatch", observedAt: new Date("2026-07-10T20:00:00.000Z") };

    expect(classifyCohortMonitoringObservation(await repository.record(input))).toBe("state_observation");
    expect(classifyCohortMonitoringObservation(await repository.record({ ...input, observedAt: new Date("2026-07-10T20:00:30.000Z") }))).toBe("needs_attention");
  });

  it("resets the grace period after a normal read", async () => {
    const repository = createInMemoryCohortMonitoringObservationRepository();
    const base = { customerId: "customer-1", cohortSessionId: "session-1", rowKey: "attempt:1", observedAt: new Date("2026-07-10T20:00:00.000Z") };
    await repository.record({ ...base, signature: "runtime mismatch" });
    await repository.record({ ...base, signature: "", observedAt: new Date("2026-07-10T20:00:30.000Z") });

    expect(classifyCohortMonitoringObservation(await repository.record({ ...base, signature: "runtime mismatch", observedAt: new Date("2026-07-10T20:01:00.000Z") }))).toBe("state_observation");
  });
});
