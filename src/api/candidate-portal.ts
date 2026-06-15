import type { ExamRepository } from "@/domain/exam-catalog";
import type { Logger } from "@/observability/logger";
import type { PortalUserProvisioningStore } from "@/auth";
import {
  PortalCustomerNotFoundError,
  PortalRegistrationValidationError,
  PortalUserAlreadyExistsError,
  registerCandidate,
} from "@/auth/portal-registration";
import type { Exam } from "@/domain/exam-catalog";

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

export interface CandidateExamCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeLimitMinutes: number;
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

function toCandidateExamCatalogItem(exam: Exam): CandidateExamCatalogItem {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    timeLimitMinutes: exam.timeLimitMinutes,
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
