import type { ExamEligibilityProvider } from "@/domain/eligibility";
import { NotEligibleError } from "@/domain/errors";
import type { ExamAttempt, ExamAttemptRepository } from "@/domain/exam-attempt";
import type { IntegrationEventPublisher } from "@/domain/integration-event";

/**
 * Retired simulator self-service exam booking.
 *
 * This use case is retained only for the legacy `/demo` compatibility flow. The
 * active Candidate lifecycle schedules ExamAttempts through the portal-authenticated
 * scheduling/runtime APIs instead.
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
