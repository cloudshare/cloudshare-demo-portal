import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { ExamClock } from "@/domain/exam-clock";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { ExamTimer } from "@/domain/exam-attempt-runtime-lifecycle";
import type { Logger } from "@/observability/logger";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";
import {
  inspectExamAttemptExternalLease,
  reconcileExpiredExamAttemptExternalLease,
  recordExamAttemptExternalLeaseInspectionFailure,
} from "./exam-attempt-external-lease";

export interface ExamAttemptRuntimeDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams?: ExamRepository;
  readonly clocks?: ExamClock;
  readonly launches: LabLaunchRepository;
  readonly timer?: ExamTimer;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly diagnostics?: DiagnosticRecorder;
  readonly candidateEmail?: string;
}

export interface EnterExamAttemptRuntimeRequest {
  readonly examAttemptId: string;
  readonly candidateId: string;
}

export interface CandidateSafeBlockedEnterBody {
  readonly message: string;
}

export type EnterExamAttemptRuntimeResult =
  | {
      readonly kind: "redirect";
      readonly location: string;
      readonly body: string;
    }
  | {
      readonly kind: "blocked";
      readonly status: 400 | 403 | 404 | 409 | 423;
      readonly body: CandidateSafeBlockedEnterBody;
    };

const ENTERABLE_STATUSES = new Set(["ready", "in_progress"]);

export async function enterExamAttemptRuntime(
  deps: ExamAttemptRuntimeDeps,
  request: EnterExamAttemptRuntimeRequest,
): Promise<EnterExamAttemptRuntimeResult> {
  let attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return blocked(404, "Exam attempt not found.");
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
    return blocked(403, "Exam entry is not allowed for this candidate.");
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
    return blocked(404, "Exam attempt not found.");
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
    return blocked(403, "Exam entry is not available for this attempt.");
  }

  const now = (deps.now ?? (() => new Date()))();

  if (!attempt.scheduledFor || now.getTime() < attempt.scheduledFor.getTime()) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Exam entry not available before scheduled start time",
      details: { scheduledFor: attempt.scheduledFor?.toISOString() },
    });
    return blocked(403, "Exam entry is not available before the scheduled start time.");
  }

  const exam = deps.exams ? await deps.exams.findById(attempt.examId) : null;
  if (exam && now.getTime() >= attempt.scheduledFor.getTime() + exam.openPeriodMinutes * 60_000) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Exam entry not available after the authored open period",
      details: {
        scheduledFor: attempt.scheduledFor.toISOString(),
        openPeriodMinutes: exam.openPeriodMinutes,
        openPeriodEndedAt: new Date(attempt.scheduledFor.getTime() + exam.openPeriodMinutes * 60_000).toISOString(),
      },
    });
    return blocked(403, "Exam entry is not available after the Exam open period has closed.");
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
    return blocked(404, "Scheduled CloudShare launch not found.");
  }

  const externalLease = await inspectExamAttemptExternalLease(deps, {
    examAttemptId: request.examAttemptId,
    customerId: attempt.customerId ?? null,
  });
  await recordExamAttemptExternalLeaseInspectionFailure(deps, {
    inspection: externalLease,
    customerId: attempt.customerId ?? null,
    examId: attempt.examId,
    candidateId: request.candidateId,
    candidateEmail: deps.candidateEmail ?? null,
    source: "runtime",
    actorType: "candidate",
    message: "CloudShare external lease inspection failed during exam entry",
  });
  if (externalLease.kind === "expired") {
    await reconcileExpiredExamAttemptExternalLease(deps, {
      inspection: externalLease,
      customerId: attempt.customerId ?? null,
      examId: attempt.examId,
      candidateId: request.candidateId,
      candidateEmail: deps.candidateEmail ?? null,
      source: "runtime",
      actorType: "candidate",
      message: "ExamAttempt expired from authoritative CloudShare external lease reconciliation",
    });
    await deps.diagnostics?.record({
      ...anchors,
      level: "warn",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Exam entry failed: CloudShare lab has expired",
      externalIds: {
        ...(externalLease.trainingId ? { trainingId: externalLease.trainingId } : {}),
        ...(externalLease.environmentExternalId
          ? { environmentExternalId: externalLease.environmentExternalId }
          : {}),
      },
      request: externalLease.request
        ? {
            method: externalLease.request.method,
            path: externalLease.request.path,
            ...(externalLease.request.query ? { query: externalLease.request.query } : {}),
            ...(externalLease.request.headers ? { headers: externalLease.request.headers } : {}),
            ...(externalLease.request.body !== undefined
              ? { body: externalLease.request.body }
              : {}),
          }
        : null,
      response: externalLease.response
        ? {
            status: externalLease.response.status,
            ...(externalLease.response.headers
              ? { headers: externalLease.response.headers }
              : {}),
            body: externalLease.response.body,
            ...(externalLease.response.network
              ? { network: externalLease.response.network }
              : {}),
            ...(externalLease.response.tls ? { tls: externalLease.response.tls } : {}),
          }
        : null,
      details: {
        attemptStatus: "expired",
        failureMode: "external_lease_expired",
        environmentStatus: externalLease.environmentStatus,
      },
    });
    return blocked(
      409,
      "Exam entry is no longer available because the CloudShare lab has expired.",
    );
  }

  try {
    await deps.timer?.resumeTimer(request.examAttemptId);
  } catch (error) {
    await deps.diagnostics?.record({
      ...anchors,
      level: "error",
      operation: "exam_attempt.enter",
      outcome: "failure",
      message: "Exam entry failed while resuming the portal clock",
      details: {
        attemptStatus: attempt.status,
        failureMode: "clock_resume_failed",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  if (attempt.status === "ready") {
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
    message: "Candidate entered exam - redirecting to CloudShare",
    externalIds: {
      ...(launch.trainingId ? { trainingId: launch.trainingId } : {}),
      ...(launch.experienceId ? { experienceId: launch.experienceId } : {}),
    },
  });

  return {
    kind: "redirect",
    location: launch.loginUrl,
    body: "Redirecting to the CloudShare lab.",
  };
}

function blocked(
  status: 400 | 403 | 404 | 409 | 423,
  message: string,
): EnterExamAttemptRuntimeResult {
  return {
    kind: "blocked",
    status,
    body: { message },
  };
}

function emptyExamRepository(): ExamRepository {
  return {
    save: async () => {},
    findById: async () => null,
    listByCustomerId: async () => [],
  };
}
