import type { Logger } from "@/observability/logger";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { ExamClock } from "@/domain/exam-clock";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { ExamTimer } from "@/domain/timer-sync";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";

export interface EnterExamDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams?: ExamRepository;
  readonly clocks?: ExamClock;
  readonly launches: LabLaunchRepository;
  readonly timer?: ExamTimer;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly diagnostics?: DiagnosticRecorder;
  readonly candidateEmail?: string;
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

const ENTERABLE_STATUSES = new Set(["ready", "in_progress"]);

export async function handleEnterExam(
  deps: EnterExamDeps,
  request: EnterExamRequest,
): Promise<EnterExamResponse> {
  let attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return textResponse(404, "Exam attempt not found.");
  }

  if (attempt.candidateId !== request.candidateId) {
    deps.logger.warn("candidate attempted to enter another candidate's exam", {
      examAttemptId: request.examAttemptId,
      candidateId: request.candidateId,
      ownerCandidateId: attempt.candidateId,
      customerId: attempt.customerId ?? null,
      examId: attempt.examId,
      candidateEmail: deps.candidateEmail ?? null,
    });
    const anchors = {
      source: "runtime" as const,
      customerId: attempt.customerId ?? null,
      candidateEmail: deps.candidateEmail ?? null,
      examId: attempt.examId ?? null,
      examAttemptId: request.examAttemptId,
      actor: { type: "candidate" as const, id: request.candidateId, email: deps.candidateEmail ?? null },
      subject: { type: "exam_attempt" as const, id: request.examAttemptId },
    };
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Candidate attempted to enter another candidate's exam",
    });
    return textResponse(403, "Exam entry is not allowed for this candidate.");
  }

  const completion = await reconcileExamAttemptCompletion(
    {
      attempts: deps.attempts,
      exams: deps.exams ?? emptyExamRepository(),
      clocks: deps.clocks,
    },
    { examAttemptId: request.examAttemptId },
  );

  attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return textResponse(404, "Exam attempt not found.");
  }
  if (completion?.changed && completion.status === "completed") {
    await recordExamAttemptCompletionDiagnostic(
      deps.diagnostics,
      attempt,
      deps.candidateEmail,
    );
  }

  const anchors = {
    source: "runtime" as const,
    customerId: attempt.customerId ?? null,
    candidateEmail: deps.candidateEmail ?? null,
    examId: attempt.examId ?? null,
    examAttemptId: request.examAttemptId,
    actor: { type: "candidate" as const, id: request.candidateId, email: deps.candidateEmail ?? null },
    subject: { type: "exam_attempt" as const, id: request.examAttemptId },
  };

  if (!ENTERABLE_STATUSES.has(attempt.status)) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Exam entry not available: attempt status is not enterable",
      details: { attemptStatus: attempt.status },
    });
    return textResponse(403, "Exam entry is not available for this attempt.");
  }

  if (!attempt.scheduledFor || (deps.now ?? (() => new Date()))().getTime() < attempt.scheduledFor.getTime()) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Exam entry not available before scheduled start time",
      details: { scheduledFor: attempt.scheduledFor?.toISOString() },
    });
    return textResponse(403, "Exam entry is not available before the scheduled start time.");
  }

  const launch = await deps.launches.findByExamAttemptId(request.examAttemptId);
  if (!launch) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "No CloudShare launch found for exam attempt",
    });
    return textResponse(404, "Scheduled CloudShare launch not found.");
  }

  if (attempt.status === "ready") {
    await deps.timer?.resumeTimer(request.examAttemptId);
    await deps.attempts.save({
      ...attempt,
      status: "in_progress",
    });
  }

  await deps.diagnostics?.record({
    ...anchors,
    level: "info",
    operation: "exam_attempt.enter",
    outcome: "success",
    message: "Candidate entered exam — redirecting to CloudShare",
    externalIds: {
      ...(launch.trainingId ? { trainingId: launch.trainingId } : {}),
      ...(launch.experienceId ? { experienceId: launch.experienceId } : {}),
    },
  });

  return {
    status: 302,
    headers: {
      location: launch.loginUrl,
      "cache-control": "no-store",
    },
    body: "Redirecting to the CloudShare lab.",
  };
}

function emptyExamRepository(): ExamRepository {
  return {
    save: async () => {},
    findById: async () => null,
    listByCustomerId: async () => [],
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
