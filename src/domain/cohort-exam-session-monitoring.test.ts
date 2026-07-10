import { describe, expect, it } from "vitest";
import {
  deriveCohortExamSessionMonitoringSummary,
  deriveCohortExamSessionReconciliationRows,
  getCohortExamSessionMonitoringStateContributions,
} from "./cohort-exam-session-monitoring";

describe("cohort exam session monitoring reconciliation", () => {
  it("treats a suspended environment as compatible with a suspended portal attempt", () => {
    const rows = deriveCohortExamSessionReconciliationRows(
      [
        {
          id: "attempt-1",
          candidateEmail: "casey@helioscx.demo",
          status: "suspended",
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
        problemReasons: [],
      }),
    ]);
    expect(deriveCohortExamSessionMonitoringSummary(rows, "available").problemCount).toBe(0);
  });

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
        problemReasons: ["Portal in progress; CloudShare environment is suspended."],
      }),
    ]);
    expect(deriveCohortExamSessionMonitoringSummary(rows, "available").problemCount).toBe(1);
  });

  it("uses the environment runtime state, not inProgress membership context, to explain a suspended portal mismatch", () => {
    const rows = deriveCohortExamSessionReconciliationRows(
      [{ id: "attempt-1", candidateEmail: "casey@helioscx.demo", status: "suspended" }],
      [{
        email: "casey@helioscx.demo", matchedExamAttemptId: "attempt-1", studentId: "student-1", environmentId: "env-1",
        participationStatus: "inProgress", environmentStatus: "Running",
      }],
    );

    expect(rows[0]?.problemReasons).toEqual(["Portal suspended; CloudShare environment is running."]);
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

  it("does not classify a suspended CloudShare participant as an active summary contributor", () => {
    const rows = deriveCohortExamSessionReconciliationRows([], [{
      email: "suspended@helioscx.demo", matchedExamAttemptId: null, studentId: "student-1", environmentId: "env-1",
      participationStatus: "inProgress", environmentStatus: "Suspended",
    }]);

    expect(getCohortExamSessionMonitoringStateContributions(rows[0]!)).toEqual([]);
    expect(deriveCohortExamSessionMonitoringSummary(rows, "available").activeCount).toBe(0);
  });
});
