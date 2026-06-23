import type { ExamRepository } from "@/domain/exam-catalog";
import type { ExamClock } from "@/domain/exam-clock";
import type { Logger } from "@/observability/logger";
import type { PortalUserProvisioningStore } from "@/auth";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { EventLogRepository } from "@/domain/event-log";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { AuditRepository } from "@/domain/audit-trail";
import {
  CloudShareError,
  CloudShareRequestError,
  CloudShareResponseError,
  CloudShareTransportError,
} from "@/integrations/cloudshare";
import {
  createCloudShareLabProvisioner,
  type CloudShareLabProvisionerObserver,
} from "@/integrations/cloudshare/labs";
import { createCloudShareParticipantLister } from "@/integrations/cloudshare/participants";
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
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import { correlateEnvironmentForExamAttempt } from "@/domain/environment-correlation";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import { randomUUID } from "node:crypto";
import { recordExamAttemptCompletionDiagnostic } from "./exam-attempt-completion-diagnostics";

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
  /** Optional support diagnostics; routes always wire it. Never throws. */
  readonly diagnostics?: DiagnosticRecorder;
}

interface CandidateExamCatalogDeps {
  readonly repository: ExamRepository;
  readonly logger: Logger;
}

interface CandidateDashboardDeps extends CandidateExamCatalogDeps {
  readonly attempts: ExamAttemptRepository;
  readonly clocks?: ExamClock;
  readonly launches?: LabLaunchRepository;
  readonly connections?: CloudShareConnectionRepository;
  readonly cloudshare?: CloudShareClientFactory;
  readonly eventLog?: EventLogRepository;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newCorrelationId?: () => string;
}

interface CandidateSchedulingDeps {
  readonly exams: ExamRepository;
  readonly attempts: ExamAttemptRepository;
  readonly launches: LabLaunchRepository;
  readonly audit: AuditRepository;
  readonly eventLog: EventLogRepository;
  readonly connections: CloudShareConnectionRepository;
  readonly cloudshare: CloudShareClientFactory;
  readonly logger: Logger;
  readonly diagnostics?: DiagnosticRecorder;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly newCorrelationId?: () => string;
}

export interface CandidateExamCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
}

export interface CandidateAttemptItem {
  readonly id: string;
  readonly examId: string;
  readonly scheduledFor: string | null;
  readonly status:
    | "scheduled"
    | "ready"
    | "in_progress"
    | "suspended"
    | "completed"
    | "expired";
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

  return {
    status: 200,
    body: {
      exams: exams
        .filter((exam) => exam.status === "published")
        .map(toCandidateExamCatalogItem),
      attempts: reconciledAttempts.map((attempt) => ({
        id: attempt.id,
        examId: attempt.examId,
        scheduledFor: attempt.scheduledFor?.toISOString() ?? null,
        status: attempt.status as CandidateAttemptItem["status"],
      })),
    },
  };
}

export async function handleScheduleCandidateExam(
  deps: CandidateSchedulingDeps,
  request: CustomerRequest & {
    candidateId: string;
    candidateEmail: string;
    candidateFirstName?: string | null;
    candidateLastName?: string | null;
  } & BodyRequest,
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

  if (
    !request.candidateFirstName?.trim() ||
    !request.candidateLastName?.trim() ||
    request.candidateFirstName.trim().length < 2 ||
    request.candidateLastName.trim().length < 2
  ) {
    return {
      status: 409,
      body: {
        error:
          "Candidate first name and last name are required before scheduling an Exam.",
      },
    };
  }

  const cloudshare = deps.cloudshare.forConnection(connection);
  const examId = (body as { examId: string }).examId.trim();
  const labs = createCloudShareLabProvisioner(
    cloudshare,
    createTeamReadDiagnosticObserver({
      diagnostics: deps.diagnostics,
      customerId: request.customerId,
      candidateId: request.candidateId,
      candidateEmail: request.candidateEmail,
      examId,
      correlationId,
    }),
  );

  try {
    const result = await scheduleExam(
      {
        exams: deps.exams,
        attempts: deps.attempts,
        launches: deps.launches,
        labs,
        newId: deps.newId ?? randomUUID,
        now: deps.now ?? (() => new Date()),
        diagnostics: deps.diagnostics,
      },
      {
        customerId: request.customerId,
        candidateId: request.candidateId,
        candidateEmail: request.candidateEmail,
        candidateFirstName: request.candidateFirstName.trim(),
        candidateLastName: request.candidateLastName.trim(),
        examId,
        scheduledFor: new Date((body as { scheduledFor: string }).scheduledFor),
        correlationId,
      },
    );

    deps.logger.info("candidate exam scheduled", {
      correlationId,
      customerId: request.customerId,
      operation: "schedule_exam",
      candidateId: request.candidateId,
      examId: result.attempt.examId,
      examAttemptId: result.attempt.id,
      scheduledFor: result.attempt.scheduledFor,
      attemptStatus: result.attempt.status,
      coldStartLikely: result.coldStartLikely,
    });
    await deps.audit.write({
      id: `${result.attempt.id}:lab_launched:${correlationId}`,
      examAttemptId: result.attempt.id,
      candidateId: request.candidateId,
      action: "lab_launched",
      outcome: "success",
      details: {
        trainingId: result.trainingId,
        experienceId: result.experienceId,
      },
      occurredAt: deps.now?.() ?? new Date(),
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
      const diagnostic: Record<string, unknown> = {
        correlationId,
        customerId: request.customerId,
        candidateId: request.candidateId,
        examAttemptId: error.context.attemptId,
        operation: "schedule_exam",
        ...toProvisioningDiagnostic(error),
      };
      await deps.eventLog.append({
        eventId: correlationId,
        type: "cloudshare.schedule_exam.failed",
        occurredAt: deps.now?.() ?? new Date(),
        payload: diagnostic,
      });
      await deps.audit.write({
        id: `${error.context.attemptId}:lab_launch_failed:${correlationId}`,
        examAttemptId: error.context.attemptId,
        candidateId: request.candidateId,
        action: "lab_launch_failed",
        outcome: "failure",
        details: {
          attemptedOperation: diagnostic.attemptedOperation,
          integrationSurface: diagnostic.integrationSurface,
          method: diagnostic.method,
          path: diagnostic.path,
          failureMode: diagnostic.failureMode,
          responseStatus: diagnostic.responseStatus,
          correlationId,
        },
        error: "CloudShare provisioning failed for the scheduled exam.",
        occurredAt: deps.now?.() ?? new Date(),
      });
      deps.logger.warn("candidate exam scheduling failed", diagnostic);
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

function createTeamReadDiagnosticObserver(input: {
  diagnostics?: DiagnosticRecorder;
  customerId: string;
  candidateId: string;
  candidateEmail: string;
  examId: string;
  correlationId: string;
}): CloudShareLabProvisionerObserver | undefined {
  if (!input.diagnostics) {
    return undefined;
  }

  return {
    onTeamReadSuccess: async (event) => {
      await input.diagnostics?.record({
        source: "candidate-portal",
        customerId: input.customerId,
        candidateEmail: input.candidateEmail,
        examId: input.examId,
        correlationId: input.correlationId,
        actor: {
          type: "candidate",
          id: input.candidateId,
          email: input.candidateEmail,
        },
        subject: { type: "exam", id: input.examId },
        level: "info",
        operation: "cloudshare.resource_sync.teams.read",
        outcome: "success",
        message: "CloudShare team resource read succeeded",
        externalIds: {
          resourceType: "team",
          projectId: event.projectId,
          teamId: event.selectedTeamId,
        },
        request: { method: "GET", path: "/teams", query: { projectId: event.projectId } },
        response: { itemCount: event.itemCount, resourceIds: [...event.teamIds] },
        details: { integrationSurface: "cloudshare.v3.teams" },
      });
    },
    onTeamReadFailure: async (event) => {
      await input.diagnostics?.record({
        source: "candidate-portal",
        customerId: input.customerId,
        candidateEmail: input.candidateEmail,
        examId: input.examId,
        correlationId: input.correlationId,
        actor: {
          type: "candidate",
          id: input.candidateId,
          email: input.candidateEmail,
        },
        subject: { type: "exam", id: input.examId },
        level: "warn",
        operation: "cloudshare.resource_sync.teams.read",
        outcome: "failure",
        message: "CloudShare team resource read failed",
        externalIds: { resourceType: "team", projectId: event.projectId },
        request: { method: "GET", path: "/teams", query: { projectId: event.projectId } },
        response: {
          ...(event.responseStatus !== undefined ? { status: event.responseStatus } : {}),
        },
        details: {
          integrationSurface: event.integrationSurface,
          failureMode: event.failureMode,
        },
      });
    },
  };
}

function toCandidateExamCatalogItem(exam: Exam): CandidateExamCatalogItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
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
      method: cause.context?.method ?? base.method,
      path: cause.context?.path ?? base.path,
      host: cause.context?.host,
      integrationSurface: cause.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "http_status",
      responseStatus: cause.status,
      requestHeaders: cause.context?.requestHeaders,
      requestBody: cause.context?.requestBody,
      responseHeaders: cause.context?.responseHeaders,
      responseBody: cause.context?.responseBody,
      network: cause.context?.network,
      tls: cause.context?.tls,
    };
  }
  if (cause instanceof CloudShareTransportError) {
    return {
      ...base,
      method: cause.context?.method ?? base.method,
      path: cause.context?.path ?? base.path,
      host: cause.context?.host,
      integrationSurface: cause.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "transport",
      requestHeaders: cause.context?.requestHeaders,
      requestBody: cause.context?.requestBody,
      cause: cause.context?.cause,
    };
  }
  if (cause instanceof CloudShareResponseError) {
    return {
      ...base,
      method: cause.context?.method ?? base.method,
      path: cause.context?.path ?? base.path,
      host: cause.context?.host,
      integrationSurface: cause.context?.integrationSurface ?? base.integrationSurface,
      failureMode: "unexpected_response",
      requestHeaders: cause.context?.requestHeaders,
      requestBody: cause.context?.requestBody,
      responseHeaders: cause.context?.responseHeaders,
      responseBody: cause.context?.responseBody,
      network: cause.context?.network,
      tls: cause.context?.tls,
      issues: cause.context?.issues,
    };
  }
  return {
    ...base,
    failureMode: "unknown",
    error: cause instanceof Error ? cause.message : String(cause),
  };
}

/**
 * Best-effort Customer attribution for a failed account creation. Returns the
 * existing user's Customer (duplicate email), else the scope's Customer (admin
 * create or self-register slug), else null. Never throws.
 */
async function resolveFailureCustomerId(
  users: PortalUserProvisioningStore,
  attemptedEmail: string,
  scope: { readonly customerId?: string; readonly customerSlug?: string },
): Promise<string | null> {
  try {
    const existing = await users.findByEmail(attemptedEmail);
    if (existing) {
      return existing.customerId;
    }
    if (scope.customerId?.trim()) {
      return scope.customerId.trim();
    }
    if (scope.customerSlug?.trim()) {
      const customer = await users.findCustomerBySlug(scope.customerSlug.trim());
      return customer?.id ?? null;
    }
  } catch {
    // Attribution is best-effort; a lookup failure must not break the response.
  }
  return null;
}

async function registerCandidateFromBody(
  deps: CandidateRegistrationDeps,
  body: unknown,
  scope: { readonly customerId?: string; readonly customerSlug?: string },
): Promise<CandidatePortalResponse> {
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { firstName?: unknown }).firstName !== "string" ||
    typeof (body as { lastName?: unknown }).lastName !== "string" ||
    typeof (body as { email?: unknown }).email !== "string" ||
    typeof (body as { password?: unknown }).password !== "string"
  ) {
    return {
      status: 400,
      body: { error: "firstName, lastName, email, and password are required" },
    };
  }

  // Attempted email for failure diagnostics; never record the submitted password.
  const attemptedEmail = (body as { email: string }).email.trim().toLowerCase();

  try {
    const candidate = await registerCandidate(deps, {
      firstName: (body as { firstName: string }).firstName,
      lastName: (body as { lastName: string }).lastName,
      email: (body as { email: string }).email,
      password: (body as { password: string }).password,
      customerId: scope.customerId,
      customerSlug: scope.customerSlug,
    });

    await deps.diagnostics?.record({
      level: "info",
      source: "candidate-portal",
      operation: "candidate.account.create",
      outcome: "success",
      customerId: candidate.customerId,
      actor: { type: "candidate", id: candidate.id, email: candidate.email },
      subject: { type: "candidate", id: candidate.id },
      candidateEmail: candidate.email,
      message: "Candidate account created",
    });

    return {
      status: 201,
      body: {
        candidate: {
          email: candidate.email,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          role: candidate.role,
          customerId: candidate.customerId,
        },
      },
    };
  } catch (error) {
    // Attribute the failure to its owning Customer where knowable (existing user
    // for a duplicate, or the registration scope), so it surfaces in that
    // Customer's Support view. Resolution never throws into this flow.
    const failureCustomerId = await resolveFailureCustomerId(
      deps.users,
      attemptedEmail,
      scope,
    );

    // Record every failure — including unexpected store errors — so the support
    // log explains the failures it most needs to. Never log the password.
    await deps.diagnostics?.record({
      level: "warn",
      source: "candidate-portal",
      operation: "candidate.account.create",
      outcome: "failure",
      customerId: failureCustomerId,
      actor: { type: "candidate", email: attemptedEmail },
      subject: { type: "candidate" },
      candidateEmail: attemptedEmail,
      message: `Candidate account creation failed: ${error instanceof Error ? error.name : "unexpected error"}`,
      details: { reason: error instanceof Error ? error.name : "unexpected_error" },
    });

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

async function correlateCandidateAttemptEnvironments(
  deps: CandidateDashboardDeps,
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
