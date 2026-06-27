import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ActiveExamAttemptStatus,
  ExamAttemptStatus,
  LegacyExamAttemptStatus,
} from "./exam-attempt";

describe("ExamAttempt status vocabulary", () => {
  it("splits active lifecycle statuses from the legacy persisted status", () => {
    const source = readFileSync("src/domain/exam-attempt.ts", "utf8");

    expect(source).toContain("export type ActiveExamAttemptStatus");
    expect(source).toContain("export type LegacyExamAttemptStatus");

    const legacyStatus: LegacyExamAttemptStatus = "booked";
    const persistedStatus: ExamAttemptStatus = legacyStatus;
    const activeStatus: ActiveExamAttemptStatus = "scheduled";
    // @ts-expect-error booked is intentionally legacy-only.
    const retiredStatus: ActiveExamAttemptStatus = "booked";

    expect(persistedStatus).toBe("booked");
    expect(activeStatus).toBe("scheduled");
    expect(retiredStatus).toBe("booked");
  });
});
