import { describe, expect, it } from "vitest";
import {
  deriveCohortExamSessionMonitoringSummary,
  deriveCohortExamSessionReconciliationRows,
} from "./cohort-exam-session-monitoring";

describe("cohort exam session monitoring reconciliation", () => {
  it("describes a portal and CloudShare runtime mismatch with the CloudShare suspended state", () => {
    const rows = deriveCohortExamSessionReconciliationRows(
      [
        {
          id: "attempt-1",
          candidateEmail: "casey@helioscx.demo",
          status: "in_progress",
        },
      ],
      [
        {
          email: "casey@helioscx.demo",
          matchedExamAttemptId: "attempt-1",
          studentId: "student-1",
          environmentId: "env-1",
          participationStatus: "inProgress",
          environmentStatus: "Suspended",
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        problemReasons: ["Portal in progress; CloudShare environment is Suspended."],
      }),
    ]);
    expect(deriveCohortExamSessionMonitoringSummary(rows, "available").problemCount).toBe(1);
  });

  it("describes a CloudShare participant with no matching portal attempt", () => {
    const rows = deriveCohortExamSessionReconciliationRows(
      [],
      [
        {
          email: "casey@helioscx.demo",
          matchedExamAttemptId: null,
          studentId: "student-1",
          environmentId: "env-1",
          participationStatus: "assigned",
          environmentStatus: "Ready",
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        problemReasons: ["CloudShare participant has no matching portal attempt."],
      }),
    ]);
    expect(deriveCohortExamSessionMonitoringSummary(rows, "available").problemCount).toBe(1);
  });
});
