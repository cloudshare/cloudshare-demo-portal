import type { ExamRepository } from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import type { PortalUserProvisioningStore } from "@/auth";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import {
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import { createCloudShareLabProvisioner } from "@/integrations/cloudshare/labs";
import {
  PortalCustomerNotFoundError,
  PortalRegistrationValidationError,
  PortalUserAlreadyExistsError,
  registerCandidate,
} from "@/auth/portal-registration";
import type { Exam } from "@/domain/exam-catalog";
import {
  CloudShareProvisioningError,
  ScheduleExamNotFoundError,
  ScheduleValidationError,
  scheduleExam,
} from "@/domain/scheduling";
import { randomUUID } from "node:crypto";

export const SELF_REGISTER_CUSTOMER_SLUG = "helios-cx";

interface CandidatePortalResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

interface BodyRequest {
  readonly body?: unknown;
}

interface CustomerRequest {
  readonly customerId: string;
}

interface CandidateRegistrationDeps {
  readonly users: PortalUserProvisioningStore;
  readonly logger: Logger;
}

interface CandidateExamCatalogDeps {
  readonly repository: ExamRepository;
  readonly logger: Logger;
}

interface CandidateDashboardDeps extends CandidateExamCatalogDeps {
  readonly attempts: ExamAttemptRepository;
}

interface CandidateSchedulingDeps {
  readonly exams: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly logger: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface CandidateExamCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
}

export interface CandidateAttemptItem {
  readonly id: string;
  readonly examId: string;
  readonly scheduledFor: string;
  readonly status: "scheduled" | "ready";
}

export async function handleCandidateSelfRegistration(
  deps: CandidateRegistrationDeps,
  request: BodyRequest,
): Promise<CandidatePortalResponse> {
  return registerCandidateFromBody(deps, request.body, {
    customerSlug: SELF_REGISTER_CUSTOMER_SLUG,
  });
}

export async function handleAdminCreateCandidate(
  deps: CandidateRegistrationDeps,
  request: CustomerRequest & BodyRequest,
): Promise<CandidatePortalResponse> {
  return registerCandidateFromBody(deps, request.body, {
    customerId: request.customerId,
  });
}

export async function handleGetCandidateExamCatalog(
  deps: CandidateExamCatalogDeps,
  request: CustomerRequest,
): Promise<CandidatePortalResponse> {
  const exams = await deps.repository.listByCustomerId(request.customerId);
  return {
    status: 200,
    body: {
      exams: exams
        .filter((exam) => exam.status === "published")
        .map(toCandidateExamCatalogItem),
    },
  };
}

export async function handleGetCandidateDashboard(
  deps: CandidateDashboardDeps,
  request: CustomerRequest & { candidateId: string },
): Promise<CandidatePortalResponse> {
  const exams = await deps.repository.listByCustomerId(request.customerId);
  const attempts = await deps.attempts.listByCandidate(request.candidateId);

  return {
    status: 200,
    body: {
      exams: exams
        .filter((exam) => exam.status === "published")
        .map(toCandidateExamCatalogItem),
      attempts: attempts
        .filter(
          (attempt): attempt is typeof attempt & { scheduledFor: Date } =>
            (attempt.status === "scheduled" || attempt.status === "ready") &&
            attempt.scheduledFor instanceof Date,
        )
        .map((attempt) => ({
          id: attempt.id,
          examId: attempt.examId,
          scheduledFor: attempt.scheduledFor.toISOString(),
          status: attempt.status,
        })),
    },
  };
}

export async function handleScheduleCandidateExam(
  deps: CandidateSchedulingDeps,
  request: CustomerRequest & { candidateId: string; candidateEmail: string } & BodyRequest,
): Promise<CandidatePortalResponse> {
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const body = request.body;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { examId?: unknown }).examId !== "string" ||
    typeof (body as { scheduledFor?: unknown }).scheduledFor !== "string"
  ) {
    return {
      status: 400,
      body: { error: "examId and scheduledFor are required" },
    };
  }

  const connection = await deps.connections.findByCustomerId(request.customerId);
  if (!connection) {
    return {
      status: 409,
      body: { error: "CloudShare is not connected for this customer." },
    };
  }

  const cloudshare = deps.cloudshare.forConnection(connection);
  const labs = createCloudShareLabProvisioner(cloudshare);

  try {
    const result = await scheduleExam(
      {
        exams: deps.exams,
        attempts: deps.attempts,
        launches: deps.launches,
        labs,
        newId: deps.newId ?? randomUUID,
        now: deps.now ?? (() => new Date()),
      },
      {
        customerId: request.customerId,
        candidateId: request.candidateId,
        candidateEmail: request.candidateEmail,
        examId: (body as { examId: string }).examId.trim(),
        scheduledFor: new Date((body as { scheduledFor: string }).scheduledFor),
      },
    );

    deps.logger.info("candidate exam scheduled", {
      correlationId,
      operation: "schedule_exam",
      candidateId: request.candidateId,
      examId: result.attempt.examId,
      examAttemptId: result.attempt.id,
      scheduledFor: result.attempt.scheduledFor,
      attemptStatus: result.attempt.status,
      coldStartLikely: result.coldStartLikely,
    });

    return {
      status: 201,
      body: {
        attempt: result.attempt,
        coldStartLikely: result.coldStartLikely,
        correlationId,
      },
    };
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      return { status: 400, body: { error: error.message } };
    }
    if (error instanceof ScheduleExamNotFoundError) {
      return { status: 404, body: { error: "Published exam not found." } };
    }
    if (error instanceof CloudShareProvisioningError) {
      deps.logger.warn("candidate exam scheduling failed", {
        correlationId,
        candidateId: request.candidateId,
        examAttemptId: error.context.attemptId,
        operation: "schedule_exam",
        ...toProvisioningDiagnostic(error),
      });
      return {
        status: 502,
        body: {
          error: "CloudShare provisioning failed for the scheduled exam.",
          correlationId,
        },
      };
    }
    throw error;
  }
}

function toCandidateExamCatalogItem(exam: Exam): CandidateExamCatalogItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
  };
}

function toProvisioningDiagnostic(
  error: CloudShareProvisioningError,
): Record<string, unknown> {
  const pathByOperation = {
    create_training: "/v4/trainings",
    add_participant: `/v4/trainings/${error.context.trainingId ?? "{trainingId}"}/students`,
    create_sponsored_link: `/v4/trainings/${error.context.trainingId ?? "{trainingId}"}/sponsored-link`,
  } as const;
  const integrationSurfaceByOperation = {
    create_training: "cloudshare.v4.training",
    add_participant: "cloudshare.v4.training.participant",
    create_sponsored_link: "cloudshare.v4.training.sponsored_link",
  } as const;

  const base = {
    attemptedOperation: error.context.attemptedOperation,
    integrationSurface: integrationSurfaceByOperation[error.context.attemptedOperation],
    method: "POST",
    path: pathByOperation[error.context.attemptedOperation],
  };

  const cause = error.context.cause;
  if (cause instanceof CloudShareRequestError) {
    return {
      ...base,
      failureMode: "http_status",
      responseStatus: cause.status,
    };
  }
  if (cause instanceof CloudShareTransportError) {
    return {
      ...base,
      failureMode: "transport",
    };
  }
  if (cause instanceof CloudShareResponseError) {
    return {
      ...base,
      failureMode: "unexpected_response",
    };
  }
  return {
    ...base,
    failureMode: "unknown",
    error: cause instanceof Error ? cause.message : String(cause),
  };
}

async function registerCandidateFromBody(
  deps: CandidateRegistrationDeps,
  body: unknown,
  scope: { readonly customerId?: string; readonly customerSlug?: string },
): Promise<CandidatePortalResponse> {
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { email?: unknown }).email !== "string" ||
    typeof (body as { password?: unknown }).password !== "string"
  ) {
    return {
      status: 400,
      body: { error: "email and password are required" },
    };
  }

  try {
    const candidate = await registerCandidate(deps, {
      email: (body as { email: string }).email,
      password: (body as { password: string }).password,
      customerId: scope.customerId,
      customerSlug: scope.customerSlug,
    });

    return {
      status: 201,
      body: {
        candidate: {
          email: candidate.email,
          role: candidate.role,
          customerId: candidate.customerId,
        },
      },
    };
  } catch (error) {
    if (
      error instanceof PortalRegistrationValidationError ||
      error instanceof PortalCustomerNotFoundError
    ) {
      return { status: 400, body: { error: error.message } };
    }
    if (error instanceof PortalUserAlreadyExistsError) {
      return { status: 409, body: { error: "A portal user with that email already exists." } };
    }
    throw error;
  }
}
