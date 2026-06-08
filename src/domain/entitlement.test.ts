import { describe, it, expect } from "vitest";
import { computeEntitlement } from "./entitlement";
import type { ExamAttempt } from "./exam-attempt";

const booked: ExamAttempt = {
  id: "ea-1",
  candidateId: "c-1",
  examId: "GCP-ASSOC",
  status: "booked",
  createdAt: new Date(0),
};

describe("computeEntitlement", () => {
  it("allows a booked exam attempt and carries its candidate", () => {
    const entitlement = computeEntitlement("ea-1", booked);
    expect(entitlement.allowed).toBe(true);
    expect(entitlement.candidateId).toBe("c-1");
  });

  it("denies an unknown (null) exam attempt with a reason", () => {
    const entitlement = computeEntitlement("missing", null);
    expect(entitlement.allowed).toBe(false);
    expect(entitlement.reason).toMatch(/not found/);
  });
});
