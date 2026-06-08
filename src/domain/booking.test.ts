import { describe, it, expect, vi } from "vitest";
import { bookExam } from "./booking";
import { NotEligibleError } from "./errors";
import { createInMemoryExamAttemptRepository } from "@/persistence/exam-attempt-repository";
import type { ExamEligibilityProvider } from "./eligibility";
import type { IntegrationEvent } from "./integration-event";

const eligibility: ExamEligibilityProvider = {
  async listEligibleExams() {
    return [{ examId: "GCP-001", title: "Associate" }];
  },
};

function deps(overrides: Partial<Parameters<typeof bookExam>[0]> = {}) {
  let n = 0;
  const published: IntegrationEvent[] = [];
  const attempts = createInMemoryExamAttemptRepository();
  return {
    published,
    attempts,
    d: {
      eligibility,
      attempts,
      events: { publish: vi.fn(async (e: IntegrationEvent) => void published.push(e)) },
      newId: () => `id-${++n}`,
      now: () => new Date("2026-06-08T00:00:00Z"),
      ...overrides,
    },
  };
}

describe("bookExam", () => {
  it("books an eligible exam: persists a booked ExamAttempt and returns it", async () => {
    const { d, attempts } = deps();
    const attempt = await bookExam(d, { candidateId: "c-1", examId: "GCP-001" });

    expect(attempt.status).toBe("booked");
    expect(attempt.candidateId).toBe("c-1");
    expect(attempt.examId).toBe("GCP-001");
    expect(await attempts.findById(attempt.id)).toEqual(attempt);
  });

  it("emits an exam_attempt.created IntegrationEvent bound to the new attempt", async () => {
    const { d, published } = deps();
    const attempt = await bookExam(d, { candidateId: "c-1", examId: "GCP-001" });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "exam_attempt.created",
      examAttemptId: attempt.id,
      candidateId: "c-1",
      examId: "GCP-001",
    });
  });

  it("rejects an ineligible exam without persisting or emitting", async () => {
    const { d, attempts, published } = deps();
    await expect(
      bookExam(d, { candidateId: "c-1", examId: "GCP-999" }),
    ).rejects.toBeInstanceOf(NotEligibleError);

    expect(await attempts.listByCandidate("c-1")).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
