import { describe, expect, it } from "vitest";
import { buildDiagnosticLogQueryString } from "./admin-support-state";

describe("Support Diagnostics query state", () => {
  it("serialises only active filters plus bounded page parameters", () => {
    expect(buildDiagnosticLogQueryString(
      {
        examAttemptId: "attempt-1",
        candidateEmail: "candidate@helioscx.demo",
        outcome: "failure",
        source: "runtime",
        subjectId: "participant-1",
        externalId: "env-123",
      },
      { limit: 50, offset: 100 },
    )).toBe(
      "?examAttemptId=attempt-1&candidateEmail=candidate%40helioscx.demo&outcome=failure&source=runtime&subjectId=participant-1&externalId=env-123&limit=50&offset=100",
    );
  });
});
