import type { DiagnosticRecorder, DiagnosticActor } from "@/domain/diagnostic-log";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  inspectCloudShareEnvironmentLease,
  inspectCloudShareExperienceLease,
  inspectCloudShareTrainingLease,
  type ActiveCloudShareExternalLease,
  type ExpiredCloudShareExternalLease,
  type UnknownCloudShareExternalLease,
} from "@/integrations/cloudshare/external-lease";

export interface ExamAttemptExternalLeaseDeps {
  readonly launches: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly attempts?: ExamAttemptRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
}

export interface ExpiredCloudShareLeaseInspection
  extends ExpiredCloudShareExternalLease {
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
}

export interface ActiveCloudShareLeaseInspection
  extends ActiveCloudShareExternalLease {
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
}

export interface UnknownCloudShareLeaseInspection
  extends UnknownCloudShareExternalLease {
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
}

export type CloudShareLeaseInspection =
  | ExpiredCloudShareLeaseInspection
  | ActiveCloudShareLeaseInspection
  | UnknownCloudShareLeaseInspection;

export async function inspectExamAttemptExternalLease(
  deps: ExamAttemptExternalLeaseDeps,
  input: {
    readonly examAttemptId: string;
    readonly customerId?: string | null;
    readonly environmentExternalId?: string | null;
  },
): Promise<CloudShareLeaseInspection> {
  const launch = await deps.launches.findByExamAttemptId(input.examAttemptId);
  const trainingId = launch?.trainingId ?? null;
  const experienceId = launch?.experienceId ?? null;
  const environmentExternalId =
    input.environmentExternalId !== undefined
      ? input.environmentExternalId
      : launch?.environmentExternalId ?? launch?.environmentId ?? null;

  if (!launch || !input.customerId || !deps.connections || !deps.cloudshare) {
    return unknownInspection({
      examAttemptId: input.examAttemptId,
      trainingId,
      experienceId,
      environmentExternalId,
    });
  }

  const connection = await deps.connections.findByCustomerId(input.customerId);
  if (!connection) {
    return unknownInspection({
      examAttemptId: input.examAttemptId,
      trainingId,
      experienceId,
      environmentExternalId,
    });
  }

  const client = deps.cloudshare.forConnection(connection);
  const inspectedLease = environmentExternalId
    ? await inspectCloudShareEnvironmentLease(client, environmentExternalId)
    : trainingId
      ? await inspectCloudShareTrainingLease(client, trainingId, {
          now: (deps.now ?? (() => new Date()))(),
        })
      : experienceId
        ? await inspectCloudShareExperienceLease(client, experienceId, {
            now: (deps.now ?? (() => new Date()))(),
          })
        : null;

  if (!inspectedLease) {
    return unknownInspection({
      examAttemptId: input.examAttemptId,
      trainingId,
      experienceId,
      environmentExternalId,
    });
  }

  return {
    ...inspectedLease,
    examAttemptId: input.examAttemptId,
    trainingId,
    experienceId,
    environmentExternalId,
  };
}

export async function reconcileExpiredExamAttemptExternalLease(
  deps: Pick<ExamAttemptExternalLeaseDeps, "attempts" | "diagnostics">,
  input: {
    readonly inspection: CloudShareLeaseInspection;
    readonly customerId?: string | null;
    readonly examId?: string | null;
    readonly candidateId?: string | null;
    readonly candidateEmail?: string | null;
    readonly source: string;
    readonly actorType: "candidate" | "admin" | "system";
    readonly message: string;
  },
): Promise<void> {
  if (input.inspection.kind !== "expired" || !deps.attempts) {
    return;
  }

  const attempt = await deps.attempts.findById(input.inspection.examAttemptId);
  if (!attempt || attempt.status === "expired") {
    return;
  }

  await deps.attempts.save({
    ...attempt,
    status: "expired",
  });

  await deps.diagnostics?.record({
    level: "warn",
    source: input.source,
    operation: "exam_attempt.expired",
    outcome: "success",
    message: input.message,
    customerId: input.customerId ?? attempt.customerId ?? null,
    candidateEmail: input.candidateEmail ?? null,
    examId: input.examId ?? attempt.examId,
    examAttemptId: input.inspection.examAttemptId,
    actor: makeActor(input.actorType, input.candidateId ?? attempt.candidateId, input.candidateEmail),
    subject: { type: "exam_attempt", id: input.inspection.examAttemptId },
    externalIds: toExternalIds(input.inspection),
    request: input.inspection.request ?? null,
    response: input.inspection.response ?? null,
    details: {
      attemptedOperation: input.inspection.attemptedOperation,
      integrationSurface: input.inspection.integrationSurface,
      method: input.inspection.method,
      path: input.inspection.path,
      failureMode: "external_lease_expired",
      reason: input.inspection.reason ?? null,
      responseStatus: input.inspection.responseStatus ?? null,
      attemptStatus: "expired",
      ...(input.inspection.environmentStatus
        ? { environmentStatus: input.inspection.environmentStatus }
        : {}),
      ...(input.inspection.leaseEndsAt
        ? { leaseEndsAt: input.inspection.leaseEndsAt }
        : {}),
    },
  });
}

export async function recordExamAttemptExternalLeaseInspectionFailure(
  deps: Pick<ExamAttemptExternalLeaseDeps, "diagnostics">,
  input: {
    readonly inspection: CloudShareLeaseInspection;
    readonly customerId?: string | null;
    readonly examId?: string | null;
    readonly candidateId?: string | null;
    readonly candidateEmail?: string | null;
    readonly source: string;
    readonly actorType: "candidate" | "admin" | "system";
    readonly message: string;
  },
): Promise<void> {
  if (input.inspection.kind !== "unknown" || !input.inspection.failureMode) {
    return;
  }

  await deps.diagnostics?.record({
    level: "warn",
    source: input.source,
    operation: "cloudshare.exam_attempt_external_lease.read",
    outcome: "failure",
    message: input.message,
    customerId: input.customerId ?? null,
    candidateEmail: input.candidateEmail ?? null,
    examId: input.examId ?? null,
    examAttemptId: input.inspection.examAttemptId,
    actor: makeActor(input.actorType, input.candidateId ?? null, input.candidateEmail),
    subject: { type: "exam_attempt", id: input.inspection.examAttemptId },
    externalIds: toExternalIds(input.inspection),
    request: input.inspection.request ?? null,
    response: input.inspection.response ?? null,
    details: {
      attemptedOperation: input.inspection.attemptedOperation,
      integrationSurface: input.inspection.integrationSurface,
      method: input.inspection.method,
      path: input.inspection.path,
      failureMode: input.inspection.failureMode,
      responseStatus: input.inspection.responseStatus ?? null,
      ...(input.inspection.error ? { error: input.inspection.error } : {}),
    },
  });
}

function unknownInspection(input: {
  readonly examAttemptId: string;
  readonly trainingId: string | null;
  readonly experienceId: string | null;
  readonly environmentExternalId: string | null;
}): UnknownCloudShareLeaseInspection {
  return {
    kind: "unknown",
    target: input.environmentExternalId
      ? "environment"
      : input.trainingId
        ? "training"
        : "experience",
    attemptedOperation: input.environmentExternalId
      ? "get_environment"
      : input.trainingId
        ? "get_training"
        : "get_experience",
    integrationSurface: input.environmentExternalId
      ? "cloudshare.v3.env.get"
      : input.trainingId
        ? "cloudshare.v4.training.get"
        : "cloudshare.v4.experience.get",
    method: "GET",
    path: input.environmentExternalId
      ? `/v3/envs/${input.environmentExternalId}`
      : input.trainingId
        ? `/v4/trainings/${input.trainingId}`
        : input.experienceId
          ? `/v4/experiences/${input.experienceId}`
          : "/v4/experiences/{experienceId}",
    examAttemptId: input.examAttemptId,
    trainingId: input.trainingId,
    experienceId: input.experienceId,
    environmentExternalId: input.environmentExternalId,
  };
}

function toExternalIds(inspection: CloudShareLeaseInspection): Record<string, string> | null {
  const externalIds = {
    ...(inspection.trainingId ? { trainingId: inspection.trainingId } : {}),
    ...(inspection.experienceId ? { experienceId: inspection.experienceId } : {}),
    ...(inspection.environmentExternalId
      ? { environmentExternalId: inspection.environmentExternalId }
      : {}),
  };
  return Object.keys(externalIds).length > 0 ? externalIds : null;
}

function makeActor(
  type: "candidate" | "admin" | "system",
  id: string | null,
  email: string | null | undefined,
): DiagnosticActor {
  return {
    type,
    id,
    email: email ?? null,
  };
}
