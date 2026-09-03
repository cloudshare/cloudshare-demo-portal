import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { ExamRepository } from "@/domain/exam-catalog";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  createCloudShareTrainingDelivery,
  SCORING_LIMITATIONS,
} from "@/integrations/cloudshare/training-delivery";
import type { Logger } from "@/observability/logger";
import { getExamAttemptScoreRuntime } from "./exam-attempt-score-runtime";
import { certificationCloudShareWorkflow } from "./certification-cloudshare-observer";

export interface CompletedExamScoreCaptureDeps {
  readonly attempts: Pick<ExamAttemptRepository, "findById">;
  readonly exams: ExamRepository;
  readonly launches?: LabLaunchRepository;
  readonly audit?: AuditRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly diagnostics?: DiagnosticRecorder;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

export async function captureCompletedExamScoreEvidence(
  deps: CompletedExamScoreCaptureDeps,
  input: {
    readonly examAttemptId: string;
    readonly candidateEmail?: string | null;
    readonly completionReason: string;
  },
): Promise<void> {
  if (!deps.launches || !deps.audit || !deps.connections || !deps.cloudshare) {
    return;
  }

  try {
    const attempt = await deps.attempts.findById(input.examAttemptId);
    if (!attempt || attempt.status !== "completed" || !attempt.customerId) {
      return;
    }

    const response = await getExamAttemptScoreRuntime(
      {
        exams: deps.exams,
        launches: deps.launches,
        audit: deps.audit,
        connections: deps.connections,
        createScoreRetriever: (connection, observation) =>
          createCloudShareTrainingDelivery(deps.cloudshare!.forConnection(connection, observation)),
        createParticipantLister: (connection, observation) =>
          createCloudShareTrainingDelivery(deps.cloudshare!.forConnection(connection, observation)),
        logger: deps.logger,
        limitations: SCORING_LIMITATIONS,
        diagnostics: deps.diagnostics,
        now: deps.now,
        newCorrelationId: deps.newCorrelationId,
      },
      {
        attempt,
        customerId: attempt.customerId,
      },
    );

    if (response.status >= 400) {
      await recordScoreCaptureWarning(deps, input, {
        status: response.status,
        error: typeof response.body.error === "string" ? response.body.error : undefined,
        correlationId:
          typeof response.body.correlationId === "string" ? response.body.correlationId : undefined,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordScoreCaptureWarning(deps, input, { error: message });
  }
}

async function recordScoreCaptureWarning(
  deps: Pick<CompletedExamScoreCaptureDeps, "diagnostics" | "logger">,
  input: {
    readonly examAttemptId: string;
    readonly candidateEmail?: string | null;
    readonly completionReason: string;
  },
  details: {
    readonly status?: number;
    readonly error?: string;
    readonly correlationId?: string;
  },
): Promise<void> {
  deps.logger.warn("post-completion score capture failed", {
    examAttemptId: input.examAttemptId,
    completionReason: input.completionReason,
    ...details,
  });
  await deps.diagnostics?.record({
    source: "runtime",
    level: "warn",
    operation: "exam_attempt.completed.score_capture",
    outcome: "failure",
    message: "Post-completion score capture failed",
    candidateEmail: input.candidateEmail ?? null,
    examAttemptId: input.examAttemptId,
    actor: {
      type: "candidate",
      email: input.candidateEmail ?? null,
    },
    subject: {
      type: "exam_attempt",
      id: input.examAttemptId,
    },
    details: {
      completionReason: input.completionReason,
      ...details,
    },
  });
}
