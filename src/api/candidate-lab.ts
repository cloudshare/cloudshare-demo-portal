import type { ExamClock } from "@/domain/exam-clock";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { Logger } from "@/observability/logger";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";

export interface CandidateLabStatusDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams: ExamRepository;
  readonly clocks?: ExamClock;
  readonly logger: Logger;
}

export interface CandidateLabStatusResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleGetCandidateLabStatus(
  deps: CandidateLabStatusDeps,
  request: {
    readonly examAttemptId: string;
    readonly candidateId: string;
  },
): Promise<CandidateLabStatusResponse> {
  const reconciliation = await reconcileExamAttemptCompletion(deps, {
    examAttemptId: request.examAttemptId,
  });
  if (!reconciliation) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }

  const attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt || attempt.candidateId !== request.candidateId) {
    deps.logger.warn("candidate requested another candidate's lab status", {
      examAttemptId: request.examAttemptId,
      candidateId: request.candidateId,
      ownerCandidateId: attempt?.candidateId,
    });
    return { status: 403, body: { error: "forbidden" } };
  }

  const exam = await deps.exams.findById(attempt.examId);
  if (!exam) {
    return { status: 404, body: { error: "exam not found" } };
  }

  return {
    status: 200,
    body: {
      examAttemptId: attempt.id,
      examTitle: exam.title,
      timeLimitMinutes: exam.timeLimitMinutes,
      status: attempt.status,
      scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
    },
  };
}
