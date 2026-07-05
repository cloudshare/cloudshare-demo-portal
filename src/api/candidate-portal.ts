import type { ExamRepository } from "@/domain/exam-catalog";
import type { ExamAttemptRepository } from "@/domain/exam-attempt";
import type { Logger } from "@/observability/logger";
import type { PortalUserProvisioningStore } from "@/auth";
import type { AuditRepository } from "@/domain/audit-trail";
import type {
  CloudShareClientFactory,
  CloudShareConnectionRepository,
} from "@/domain/cloudshare-connection";
import {
  PortalCustomerNotFoundError,
  PortalRegistrationValidationError,
  PortalUserAlreadyExistsError,
  registerCandidate,
} from "@/auth/portal-registration";
import type { Exam } from "@/domain/exam-catalog";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import type { EventLogRepository } from "@/domain/event-log";
import type { ExamClock } from "@/domain/exam-clock";
import type { LabLaunchRepository } from "@/domain/lab-launch";
import type { CohortExamSessionRepository } from "@/domain/cohort-exam-session";
import {
  getExamAttemptDashboardRuntime,
  type CandidateDashboardAttemptItem,
  type ExamAttemptDashboardRuntimeDeps,
} from "./exam-attempt-dashboard-runtime";
import {
  scheduleExamAttemptRuntime,
  type ExamAttemptSchedulingRuntimeDeps,
} from "./exam-attempt-scheduling-runtime";
import {
  joinCohortExamSessionRuntime,
  type CohortExamSessionJoinRuntimeDeps,
} from "./cohort-exam-session-join-runtime";

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

export interface CandidateRegistrationDeps {
  readonly users: PortalUserProvisioningStore;
  readonly logger: Logger;
  /** Optional support diagnostics; routes always wire it. Never throws. */
  readonly diagnostics?: DiagnosticRecorder;
}

export interface CandidateRegistrationServices {
  readonly portalUsers: PortalUserProvisioningStore;
  readonly logger: Logger;
  readonly diagnosticRecorder?: DiagnosticRecorder;
}

export function buildCandidateRegistrationDeps(
  services: CandidateRegistrationServices,
): CandidateRegistrationDeps {
  return {
    users: services.portalUsers,
    logger: services.logger,
    diagnostics: services.diagnosticRecorder,
  };
}

export function buildCandidateDashboardDeps(
  services: CandidateDashboardServices,
): CandidateDashboardDeps {
  return {
    repository: services.exams,
    attempts: services.examAttempts,
    cohortSessions: services.cohortExamSessions,
    clocks: services.examClock,
    launches: services.labLaunches,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    eventLog: services.eventLog,
    diagnostics: services.diagnosticRecorder,
    logger: services.logger,
  };
}

export function buildCandidateSchedulingDeps(
  services: CandidateSchedulingServices,
): CandidateSchedulingDeps {
  return {
    exams: services.exams,
    attempts: services.examAttempts,
    launches: services.labLaunches,
    audit: services.audit,
    eventLog: services.eventLog,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    logger: services.logger,
    diagnostics: services.diagnosticRecorder,
  };
}

export function buildCandidateCohortJoinDeps(
  services: CandidateCohortJoinServices,
): CandidateCohortJoinDeps {
  return {
    exams: services.exams,
    sessions: services.cohortExamSessions,
    attempts: services.examAttempts,
    launches: services.labLaunches,
    audit: services.audit,
    eventLog: services.eventLog,
    connections: services.cloudshareConnections,
    cloudshare: services.cloudshareClientFactory,
    logger: services.logger,
    diagnostics: services.diagnosticRecorder,
  };
}

interface CandidateExamCatalogDeps {
  readonly repository: ExamRepository;
  readonly logger: Logger;
}

type CandidateDashboardDeps = ExamAttemptDashboardRuntimeDeps;

type CandidateSchedulingDeps = ExamAttemptSchedulingRuntimeDeps;

type CandidateCohortJoinDeps = CohortExamSessionJoinRuntimeDeps;

export interface CandidateDashboardServices {
  readonly exams: ExamRepository;
  readonly cohortExamSessions?: CohortExamSessionRepository;
  readonly examAttempts: ExamAttemptRepository;
  readonly examClock: ExamClock;
  readonly labLaunches: LabLaunchRepository;
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly eventLog: EventLogRepository;
  readonly diagnosticRecorder: DiagnosticRecorder;
  readonly logger: Logger;
}

export interface CandidateSchedulingServices {
  readonly exams: ExamRepository;
  readonly examAttempts: ExamAttemptRepository;
  readonly labLaunches: LabLaunchRepository;
  readonly audit: AuditRepository;
  readonly eventLog: EventLogRepository;
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly diagnosticRecorder: DiagnosticRecorder;
  readonly logger: Logger;
}

export interface CandidateCohortJoinServices {
  readonly exams: ExamRepository;
  readonly cohortExamSessions: CohortExamSessionRepository;
  readonly examAttempts: ExamAttemptRepository;
  readonly labLaunches: LabLaunchRepository;
  readonly audit: AuditRepository;
  readonly eventLog: EventLogRepository;
  readonly cloudshareConnections: CloudShareConnectionRepository;
  readonly cloudshareClientFactory: CloudShareClientFactory;
  readonly diagnosticRecorder: DiagnosticRecorder;
  readonly logger: Logger;
}

export interface CandidateExamCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
  readonly openPeriodMinutes: number;
  readonly scoreRetrievalEnabled: boolean;
}

export type CandidateAttemptItem = CandidateDashboardAttemptItem;

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
  return getExamAttemptDashboardRuntime(deps, request);
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

  const examId = (body as { examId: string }).examId.trim();
  return scheduleExamAttemptRuntime(deps, {
    customerId: request.customerId,
    candidateId: request.candidateId,
    candidateEmail: request.candidateEmail,
    candidateFirstName: request.candidateFirstName,
    candidateLastName: request.candidateLastName,
    examId,
    scheduledFor: (body as { scheduledFor: string }).scheduledFor,
  });
}

export async function handleJoinCandidateCohortExamSession(
  deps: CandidateCohortJoinDeps,
  request: CustomerRequest & {
    candidateId: string;
    candidateEmail: string;
    candidateFirstName?: string | null;
    candidateLastName?: string | null;
  } & BodyRequest,
): Promise<CandidatePortalResponse> {
  const body = request.body;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { examId?: unknown }).examId !== "string" ||
    typeof (body as { cohortSessionId?: unknown }).cohortSessionId !== "string"
  ) {
    return {
      status: 400,
      body: { error: "examId and cohortSessionId are required" },
    };
  }

  return joinCohortExamSessionRuntime(deps, {
    customerId: request.customerId,
    candidateId: request.candidateId,
    candidateEmail: request.candidateEmail,
    candidateFirstName: request.candidateFirstName,
    candidateLastName: request.candidateLastName,
    examId: (body as { examId: string }).examId.trim(),
    cohortSessionId: (body as { cohortSessionId: string }).cohortSessionId.trim(),
  });
}

function toCandidateExamCatalogItem(exam: Exam): CandidateExamCatalogItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
    openPeriodMinutes: exam.openPeriodMinutes,
    scoreRetrievalEnabled: exam.scoreRetrievalEnabled,
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

