import type { Logger } from "@/observability/logger";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";

export interface EnterExamDeps {
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface EnterExamRequest {
  readonly examAttemptId: string;
  readonly candidateId: string;
}

export interface EnterExamResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const ENTERABLE_STATUSES = new Set(["ready", "in_progress", "suspended"]);

export async function handleEnterExam(
  deps: EnterExamDeps,
  request: EnterExamRequest,
): Promise<EnterExamResponse> {
  const attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return textResponse(404, "Exam attempt not found.");
  }

  if (attempt.candidateId !== request.candidateId) {
    deps.logger.warn("candidate attempted to enter another candidate's exam", {
      examAttemptId: request.examAttemptId,
      candidateId: request.candidateId,
      ownerCandidateId: attempt.candidateId,
    });
    return textResponse(403, "Exam entry is not allowed for this candidate.");
  }

  if (!ENTERABLE_STATUSES.has(attempt.status)) {
    return textResponse(403, "Exam entry is not available for this attempt.");
  }

  if (!attempt.scheduledFor || (deps.now ?? (() => new Date()))().getTime() < attempt.scheduledFor.getTime()) {
    return textResponse(403, "Exam entry is not available before the scheduled start time.");
  }

  const launch = await deps.launches.findByExamAttemptId(request.examAttemptId);
  if (!launch) {
    return textResponse(404, "Scheduled CloudShare launch not found.");
  }

  return {
    status: 302,
    headers: {
      location: launch.loginUrl,
      "cache-control": "no-store",
    },
    body: "Redirecting to the CloudShare lab.",
  };
}

function textResponse(status: number, body: string): EnterExamResponse {
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    body,
  };
}
