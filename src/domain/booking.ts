import type { ExamEligibilityProvider } from "./eligibility";
import { NotEligibleError } from "./errors";
import type { ExamAttempt, ExamAttemptRepository } from "./exam-attempt";
import type { IntegrationEventPublisher } from "./integration-event";

/**
 * Self-service exam booking — no admin in the loop. A candidate books an exam
 * they are eligible for; the use case creates and persists an {@link ExamAttempt}
 * and emits an `exam_attempt.created` IntegrationEvent that begins the downstream
 * lab-launch flow. Eligibility is re-checked here so the seam, not the UI, is the
 * authority on what may be booked.
 *
 * Pure and framework-agnostic: it depends only on ports, so it is exercised
 * directly in unit tests.
 */

export interface BookExamDeps {
  readonly eligibility: ExamEligibilityProvider;
  readonly attempts: ExamAttemptRepository;
  readonly events: IntegrationEventPublisher;
  /** Unique id generator (attempt id, event id). Injectable for tests. */
  readonly newId: () => string;
  readonly now: () => Date;
}

export interface BookExamInput {
  readonly candidateId: string;
  readonly examId: string;
}

export async function bookExam(
  deps: BookExamDeps,
  input: BookExamInput,
): Promise<ExamAttempt> {
  const eligible = await deps.eligibility.listEligibleExams(input.candidateId);
  if (!eligible.some((exam) => exam.examId === input.examId)) {
    throw new NotEligibleError("Candidate is not eligible to book this exam", {
      candidateId: input.candidateId,
      examId: input.examId,
    });
  }

  const attempt: ExamAttempt = {
    id: deps.newId(),
    candidateId: input.candidateId,
    examId: input.examId,
    status: "booked",
    createdAt: deps.now(),
  };
  await deps.attempts.save(attempt);

  await deps.events.publish({
    id: deps.newId(),
    occurredAt: deps.now(),
    type: "exam_attempt.created",
    examAttemptId: attempt.id,
    candidateId: attempt.candidateId,
    examId: attempt.examId,
  });

  return attempt;
}
