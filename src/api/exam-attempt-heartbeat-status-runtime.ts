import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EnvironmentStateSource } from "@/domain/environment";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { ExamClock } from "@/domain/exam-clock";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { HeartbeatAutoSuspend } from "@/domain/heartbeat-auto-suspend";
import type { LabLaunch } from "@/domain/lab-launch";
import { createCloudShareEnvironmentSource } from "@/integrations/cloudshare/environment";
import type { Logger } from "@/observability/logger";
import {
  recordExamAttemptCompletionDiagnostic,
  recordExamAttemptCompletionEnvironmentDiagnostic,
} from "./exam-attempt-completion-diagnostics";

export interface ExamAttemptHeartbeatStatusDeps {
  readonly attempts: ExamAttemptRepository;
  readonly exams: ExamRepository;
  readonly clocks?: ExamClock;
  readonly diagnostics?: DiagnosticRecorder;
  readonly candidateEmail?: string;
  readonly logger: Logger;
}

export interface CandidateLabStatusRuntimeRequest {
  readonly examAttemptId: string;
  readonly candidateId: string;
}

export interface ManualHeartbeatRuntimeDeps extends ExamAttemptHeartbeatStatusDeps {
  readonly autoSuspend: HeartbeatAutoSuspend;
  readonly environmentSource?: EnvironmentStateSource;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
}

export interface ManualHeartbeatRuntimeRequest {
  readonly examAttemptId: string;
  readonly candidateId: string;
  readonly launch: LabLaunch | null;
}

export interface ExamAttemptHeartbeatStatusResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function getCandidateLabStatusRuntime(
  deps: ExamAttemptHeartbeatStatusDeps,
  request: CandidateLabStatusRuntimeRequest,
): Promise<ExamAttemptHeartbeatStatusResponse> {
  const attempt = await deps.attempts.findById(request.examAttemptId);
  if (!attempt) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }
  if (attempt.candidateId !== request.candidateId) {
    deps.logger.warn("candidate requested another candidate's lab status", {
      examAttemptId: request.examAttemptId,
      candidateId: request.candidateId,
      ownerCandidateId: attempt.candidateId,
      customerId: attempt.customerId ?? null,
      examId: attempt.examId,
    });
    return { status: 403, body: { error: "forbidden" } };
  }

  const completion = await reconcileExamAttemptCompletion(deps, {
    examAttemptId: request.examAttemptId,
  });

  const reconciledAttempt = await deps.attempts.findById(request.examAttemptId);
  if (!reconciledAttempt) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }
  if (completion?.changed && completion.status === "completed") {
    await recordExamAttemptCompletionDiagnostic(
      deps.diagnostics,
      reconciledAttempt,
      deps.candidateEmail,
    );
  }

  const exam = await deps.exams.findById(reconciledAttempt.examId);
  if (!exam) {
    return { status: 404, body: { error: "exam not found" } };
  }

  return {
    status: 200,
    body: {
      examAttemptId: reconciledAttempt.id,
      examTitle: exam.title,
      timeLimitMinutes: exam.timeLimitMinutes,
      status: reconciledAttempt.status,
      scheduledFor: reconciledAttempt.scheduledFor?.toISOString() ?? null,
    },
  };
}

export async function recordExamAttemptHeartbeatRuntime(
  deps: ManualHeartbeatRuntimeDeps,
  request: ManualHeartbeatRuntimeRequest,
): Promise<ExamAttemptHeartbeatStatusResponse> {
  const reconciliation = await reconcileExamAttemptCompletion(
    {
      attempts: deps.attempts,
      exams: deps.exams,
      clocks: deps.clocks,
    },
    { examAttemptId: request.examAttemptId },
  );

  if (reconciliation?.status === "completed") {
    deps.autoSuspend.removeHeartbeat(request.examAttemptId);
    const completedAttempt = await deps.attempts.findById(request.examAttemptId);
    await deps.diagnostics?.record({
      source: "runtime",
      customerId: completedAttempt?.customerId ?? null,
      candidateEmail: deps.candidateEmail ?? null,
      examId: completedAttempt?.examId ?? null,
      examAttemptId: request.examAttemptId,
      level: "info",
      operation: "exam_attempt.completed",
      outcome: "success",
      message: "Exam attempt completed (heartbeat reconciliation)",
      actor: {
        type: "candidate",
        id: request.candidateId,
        email: deps.candidateEmail ?? null,
      },
      subject: { type: "exam_attempt", id: request.examAttemptId },
      details: { reason: "heartbeat_reconciliation" },
    });
    if (completedAttempt) {
      await recordExamAttemptCompletionEnvironmentDiagnostic(
        {
          diagnostics: deps.diagnostics,
          source: await resolveCompletionEnvironmentSource(deps, completedAttempt.customerId),
        },
        {
          attempt: completedAttempt,
          launch: request.launch,
          candidateEmail: deps.candidateEmail ?? null,
          completionReason: "heartbeat_reconciliation",
        },
      );
    }
    return {
      status: 200,
      body: { status: "completed", attemptStatus: "completed" },
    };
  }

  const attemptAfterReconciliation = await deps.attempts.findById(request.examAttemptId);
  if (!attemptAfterReconciliation) {
    return { status: 404, body: { error: "exam attempt not found" } };
  }

  if (attemptAfterReconciliation.status === "suspended") {
    deps.autoSuspend.removeHeartbeat(request.examAttemptId);
    return {
      status: 200,
      body: { status: "suspended", attemptStatus: "suspended" },
    };
  }

  if (attemptAfterReconciliation.status !== "in_progress") {
    return { status: 409, body: { error: "exam attempt is not in progress" } };
  }

  deps.autoSuspend.recordHeartbeat(request.examAttemptId);
  deps.logger.debug("heartbeat received", { examAttemptId: request.examAttemptId });
  const attemptAfterHeartbeat = await deps.attempts.findById(request.examAttemptId);
  const authoritativeAttemptStatus =
    attemptAfterHeartbeat?.status === "suspended" || attemptAfterHeartbeat?.status === "completed"
      ? attemptAfterHeartbeat.status
      : "in_progress";

  await deps.diagnostics?.record({
    source: "runtime",
    customerId: attemptAfterReconciliation.customerId ?? null,
    candidateEmail: deps.candidateEmail ?? null,
    examId: attemptAfterReconciliation.examId ?? null,
    examAttemptId: request.examAttemptId,
    level: "info",
    operation: "exam_attempt.heartbeat.receive",
    outcome: "success",
    message: "Heartbeat received for in-progress exam attempt",
    actor: {
      type: "candidate",
      id: attemptAfterReconciliation.candidateId ?? null,
      email: deps.candidateEmail ?? null,
    },
    subject: { type: "exam_attempt", id: request.examAttemptId },
    details: { route: "/api/heartbeat" },
  });

  return {
    status: 200,
    body: {
      status: "ok",
      attemptStatus: authoritativeAttemptStatus,
    },
  };
}

async function resolveCompletionEnvironmentSource(
  deps: ManualHeartbeatRuntimeDeps,
  customerId: string | undefined,
): Promise<EnvironmentStateSource | undefined> {
  if (!customerId || !deps.connections || !deps.cloudshare) {
    return deps.environmentSource;
  }

  const connection = await deps.connections.findByCustomerId(customerId);
  if (!connection) {
    return deps.environmentSource;
  }

  return createCloudShareEnvironmentSource(deps.cloudshare.forConnection(connection));
}
