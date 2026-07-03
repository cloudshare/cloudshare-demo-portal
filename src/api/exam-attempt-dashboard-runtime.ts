import { randomUUID } from "node:crypto";
import type { CloudShareClientFactory, CloudShareConnectionRepository } from "@/domain/cloudshare-connection";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { ExamClock } from "@/domain/exam-clock";
import type { Exam, ExamRepository } from "@/domain/exam-catalog";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { EventLogRepository } from "@/domain/event-log";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareParticipantLister } from "@/integrations/cloudshare/participants";
import type { Logger } from "@/observability/logger";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";
import {
  inspectExamAttemptExternalLease,
  reconcileExpiredExamAttemptExternalLease,
  recordExamAttemptExternalLeaseInspectionFailure,
} from "./exam-attempt-external-lease";

export interface ExamAttemptDashboardRuntimeDeps {
  readonly repository: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly logger: Logger;
  readonly clocks?: ExamClock;
  readonly launches?: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly eventLog?: EventLogRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

export interface ExamAttemptDashboardRuntimeRequest {
  readonly customerId: string;
  readonly candidateId: string;
}

export interface ExamAttemptDashboardRuntimeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface CandidateDashboardExamItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
}

export interface CandidateDashboardAttemptItem {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly timeLimitMinutes: number;
  readonly storageLeaseMinutes: number | null;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
  readonly scheduledFor: string | null;
  readonly status:
    | "scheduled"
    | "ready"
    | "in_progress"
    | "suspended"
    | "completed"
    | "expired";
}

export async function getExamAttemptDashboardRuntime(
  deps: ExamAttemptDashboardRuntimeDeps,
  request: ExamAttemptDashboardRuntimeRequest,
): Promise<ExamAttemptDashboardRuntimeResponse> {
  const exams = await deps.repository.listByCustomerId(request.customerId);
  const attempts = await deps.attempts.listByCandidate(request.candidateId);

  for (const attempt of attempts) {
    const completion = await reconcileExamAttemptCompletion(
      {
        attempts: deps.attempts,
        exams: deps.repository,
        clocks: deps.clocks,
      },
      { examAttemptId: attempt.id },
    );
    if (completion?.changed && completion.status === "completed") {
      const refreshedAttempt = await deps.attempts.findById(attempt.id);
      if (refreshedAttempt) {
        await recordExamAttemptCompletionDiagnostic(
          deps.diagnostics,
          refreshedAttempt,
          null,
        );
      }
    }
  }

  const reconciledAttempts = await deps.attempts.listByCandidate(request.candidateId);
  await correlateCandidateAttemptEnvironments(
    deps,
    request.customerId,
    reconciledAttempts.map((attempt) => attempt.id),
  );
  const examsById = new Map(exams.map((exam) => [exam.id, exam]));
  const externalLeaseOverrides = await deriveExternalLeaseStatusOverrides(
    deps,
    reconciledAttempts,
    examsById,
  );

  return {
    status: 200,
    body: {
      exams: exams
        .filter((exam) => exam.status === "published")
        .map(toCandidateDashboardExamItem),
      attempts: reconciledAttempts.map((attempt) => {
        const exam = examsById.get(attempt.examId);
        return {
          id: attempt.id,
          examId: attempt.examId,
          examTitle: exam?.title ?? attempt.examId,
          timeLimitMinutes: exam?.timeLimitMinutes ?? 0,
          storageLeaseMinutes: exam?.storageLeaseMinutes ?? null,
          openPeriodMinutes: exam?.openPeriodMinutes ?? 0,
          scoreRetrievalEnabled: exam?.scoreRetrievalEnabled ?? false,
          scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
          status:
            externalLeaseOverrides.get(attempt.id) ??
            (attempt.status as CandidateDashboardAttemptItem["status"]),
        };
      }),
    },
  };
}

async function deriveExternalLeaseStatusOverrides(
  deps: ExamAttemptDashboardRuntimeDeps,
  attempts: readonly {
    readonly id: string;
    readonly customerId?: string;
    readonly candidateId: string;
    readonly examId: string;
    readonly status: string;
    readonly scheduledFor?: Date | null;
  }[],
  examsById: ReadonlyMap<string, Exam>,
): Promise<Map<string, CandidateDashboardAttemptItem["status"]>> {
  const overrides = new Map<string, CandidateDashboardAttemptItem["status"]>();
  if (!deps.launches || !deps.connections || !deps.cloudshare) {
    return overrides;
  }

  for (const attempt of attempts) {
    if (
      attempt.status !== "ready" &&
      attempt.status !== "in_progress" &&
      attempt.status !== "suspended"
    ) {
      continue;
    }
    const exam = examsById.get(attempt.examId);
    if (!hasAuthoredOpenPeriodClosed(attempt.scheduledFor ?? null, exam, deps.now)) {
      continue;
    }

    const lease = await inspectExamAttemptExternalLease(
      {
        launches: deps.launches,
        connections: deps.connections,
        cloudshare: deps.cloudshare,
        attempts: deps.attempts,
        diagnostics: deps.diagnostics,
        now: deps.now,
      },
      {
        examAttemptId: attempt.id,
        customerId: attempt.customerId ?? null,
      },
    );
    await recordExamAttemptExternalLeaseInspectionFailure(deps, {
      inspection: lease,
      customerId: attempt.customerId ?? null,
      examId: attempt.examId,
      candidateId: null,
      candidateEmail: null,
      source: "candidate_dashboard",
      actorType: "system",
      message: "CloudShare external lease inspection failed during candidate dashboard reconciliation",
    });
    if (lease.kind === "expired") {
      await reconcileExpiredExamAttemptExternalLease(
        {
          attempts: deps.attempts,
          diagnostics: deps.diagnostics,
        },
        {
          inspection: lease,
          customerId: attempt.customerId ?? null,
          examId: attempt.examId,
          candidateId: null,
          candidateEmail: null,
          source: "candidate_dashboard",
          actorType: "system",
          message: "ExamAttempt expired from authoritative CloudShare external lease reconciliation",
        },
      );
      overrides.set(attempt.id, "expired");
    }
  }

  return overrides;
}

function hasAuthoredOpenPeriodClosed(
  scheduledFor: Date | null,
  exam: Pick<Exam, "openPeriodMinutes"> | undefined,
  now: (() => Date) | undefined,
): boolean {
  if (!scheduledFor || !exam) {
    return false;
  }

  const openPeriodEndsAt = scheduledFor.getTime() + exam.openPeriodMinutes * 60_000;
  return (now ?? (() => new Date()))().getTime() >= openPeriodEndsAt;
}

function toCandidateDashboardExamItem(exam: Exam): CandidateDashboardExamItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
    storageLeaseMinutes: exam.storageLeaseMinutes ?? null,
    openPeriodMinutes: exam.openPeriodMinutes,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
  };
}

async function correlateCandidateAttemptEnvironments(
  deps: ExamAttemptDashboardRuntimeDeps,
  customerId: string,
  examAttemptIds: readonly string[],
): Promise<void> {
  if (!deps.launches || !deps.connections || !deps.cloudshare || examAttemptIds.length === 0) {
    return;
  }

  const connection = await deps.connections.findByCustomerId(customerId);
  if (!connection) {
    return;
  }

  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const participants = createCloudShareParticipantLister(deps.cloudshare.forConnection(connection));
  for (const examAttemptId of examAttemptIds) {
    const launch = await deps.launches.findByExamAttemptId(examAttemptId);
    const trainingId = launch?.trainingId;
    const path = trainingId
      ? `/v4/trainings/${trainingId}/students`
      : "/v4/trainings/{trainingId}/students";

    try {
      await correlateEnvironmentForExamAttempt(
        {
          launches: deps.launches,
          participants,
        },
        { examAttemptId },
      );
    } catch (error) {
      const diagnostic = {
        correlationId,
        customerId,
        examAttemptId,
        trainingId,
        operation: "candidate_dashboard_environment_correlation",
        attemptedOperation: "list_training_participants",
        ...toCloudShareFailureDiagnostic({
          attemptedOperation: "list_training_participants",
          integrationSurface: "cloudshare.v4.training.participant_list",
          method: "GET",
          path,
          cause: error,
        }),
      };
      await deps.eventLog?.append({
        eventId: correlationId,
        type: "cloudshare.candidate_dashboard_environment_correlation.failed",
        occurredAt: deps.now?.() ?? new Date(),
        payload: diagnostic,
      });
      deps.logger.warn("candidate dashboard environment correlation failed", diagnostic);
    }
  }
}

function toCloudShareFailureDiagnostic(input: {
  readonly attemptedOperation: string;
  readonly integrationSurface: string;
  readonly method: string;
  readonly path: string;
  readonly cause: unknown;
}): Record<string, unknown> {
  const base = {
    attemptedOperation: input.attemptedOperation,
    integrationSurface: input.integrationSurface,
    method: input.method,
    path: input.path,
  };

  const cause = asCloudShareError(input.cause);
  if (cause instanceof CloudShareRequestError || cause?.name === "CloudShareRequestError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "http_status",
      responseStatus:
        cause instanceof CloudShareRequestError ? cause.status : cause?.context?.status,
      requestHeaders: cause?.context?.requestHeaders,
      requestBody: cause?.context?.requestBody,
      responseHeaders: cause?.context?.responseHeaders,
      responseBody: cause?.context?.responseBody,
      network: cause?.context?.network,
      tls: cause?.context?.tls,
    };
  }
  if (cause instanceof CloudShareTransportError || cause?.name === "CloudShareTransportError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "transport",
      requestHeaders: cause?.context?.requestHeaders,
      requestBody: cause?.context?.requestBody,
      cause: cause?.context?.cause,
    };
  }
  if (cause instanceof CloudShareResponseError || cause?.name === "CloudShareResponseError") {
    return {
      ...base,
      method: cause?.context?.method ?? base.method,
      path: cause?.context?.path ?? base.path,
      host: cause?.context?.host,
      integrationSurface: cause?.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "unexpected_response",
      requestHeaders: cause?.context?.requestHeaders,
      requestBody: cause?.context?.requestBody,
      responseHeaders: cause?.context?.responseHeaders,
      responseBody: cause?.context?.responseBody,
      network: cause?.context?.network,
      tls: cause?.context?.tls,
      issues: cause?.context?.issues,
    };
  }
  return {
    ...base,
    failureMode: "unknown",
    error: input.cause instanceof Error ? input.cause.message : String(input.cause),
  };
}

function asCloudShareError(error: unknown): CloudShareError | null {
  if (
    error instanceof CloudShareError ||
    error instanceof CloudShareRequestError ||
    error instanceof CloudShareTransportError ||
    error instanceof CloudShareResponseError
  ) {
    return error;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { name?: unknown }).name === "string" &&
    ((error as { name: string }).name === "CloudShareError" ||
      (error as { name: string }).name === "CloudShareRequestError" ||
      (error as { name: string }).name === "CloudShareTransportError" ||
      (error as { name: string }).name === "CloudShareResponseError")
  ) {
    return error as CloudShareError;
  }

  return null;
}
