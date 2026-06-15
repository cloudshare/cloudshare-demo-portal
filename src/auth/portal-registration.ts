import { hashPassword } from "./password";
import type {
  PortalUserProvisioningStore,
  PortalUserRecord,
} from "./portal-stores";

export class PortalRegistrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalRegistrationValidationError";
  }
}

export class PortalUserAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A portal user with email ${email} already exists`);
    this.name = "PortalUserAlreadyExistsError";
  }
}

export class PortalCustomerNotFoundError extends Error {
  constructor(slug: string) {
    super(`Customer ${slug} was not found`);
    this.name = "PortalCustomerNotFoundError";
  }
}

export interface RegisterCandidateInput {
  readonly email: string;
  readonly password: string;
  readonly customerId?: string;
  readonly customerSlug?: string;
}

export interface PortalCandidateRegistrationDeps {
  readonly users: PortalUserProvisioningStore;
}

export async function registerCandidate(
  deps: PortalCandidateRegistrationDeps,
  input: RegisterCandidateInput,
): Promise<PortalUserRecord> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new PortalRegistrationValidationError("email and password are required");
  }

  const existing = await deps.users.findByEmail(email);
  if (existing) {
    throw new PortalUserAlreadyExistsError(email);
  }

  const customerId = await resolveCustomerId(deps.users, input);
  const passwordHash = await hashPassword(password);
  return deps.users.createUser({
    customerId,
    email,
    passwordHash,
    role: "candidate",
  });
}

async function resolveCustomerId(
  users: PortalUserProvisioningStore,
  input: RegisterCandidateInput,
): Promise<string> {
  if (input.customerId?.trim()) {
    return input.customerId.trim();
  }

  if (!input.customerSlug?.trim()) {
    throw new PortalRegistrationValidationError("customerId or customerSlug is required");
  }

  const customer = await users.findCustomerBySlug(input.customerSlug.trim());
  if (!customer) {
    throw new PortalCustomerNotFoundError(input.customerSlug.trim());
  }

  return customer.id;
}
