import { randomUUID } from "node:crypto";
import {
  hashPassword,
  InvalidPortalCredentialsError,
  verifyPassword,
  type PortalCustomerRecord,
  type PortalSession,
  type PortalSessionStore,
  type PortalUserProvisioningStore,
} from "@/auth";
import type { AuditRepository } from "@/domain/audit-trail";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";

const SALES_TRIAL_SOURCE = "sales-trial-portal";

export interface SalesTrialPortalRequest {
  readonly body?: unknown;
}

export interface SalesTrialPortalResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly session?: PortalSession;
}

export interface SalesTrialPortalDeps {
  readonly users: PortalUserProvisioningStore;
  readonly sessions?: PortalSessionStore;
  readonly diagnostics?: DiagnosticRecorder;
  readonly audit?: AuditRepository;
  readonly now?: () => number;
  readonly newSessionId?: () => string;
}

export async function handleSalesTrialSelfRegistration(
  deps: SalesTrialPortalDeps,
  request: SalesTrialPortalRequest,
): Promise<SalesTrialPortalResponse> {
  const body = request.body;
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

  const firstName = (body as { firstName: string }).firstName.trim();
  const lastName = (body as { lastName: string }).lastName.trim();
  const email = (body as { email: string }).email.trim().toLowerCase();
  const password = (body as { password: string }).password;

  if (!firstName || !lastName || !email || !password) {
    return {
      status: 400,
      body: { error: "firstName, lastName, email, and password are required" },
    };
  }

  if (firstName.length < 2 || lastName.length < 2) {
    return {
      status: 400,
      body: { error: "firstName and lastName must each be at least 2 characters" },
    };
  }

  const customer = await deps.users.findSalesTrialCustomer();
  if (!customer) {
    await recordFailure(deps, email, null, "sales_trial.account.create", "sales_trial_unavailable");
    return {
      status: 503,
      body: { error: "Sales Trial registration is not available right now." },
    };
  }

  const existing = await deps.users.findByEmail(email, {
    customerId: customer.id,
  });
  if (existing) {
    await recordFailure(deps, email, customer, "sales_trial.account.create", "duplicate_email");
    return {
      status: 409,
      body: { error: "A Sales Trial account with that email already exists." },
    };
  }

  const participant = await deps.users.createUser({
    customerId: customer.id,
    email,
    firstName,
    lastName,
    passwordHash: await hashPassword(password),
    role: "sales_trial_participant",
  });

  await deps.diagnostics?.record({
    level: "info",
    source: SALES_TRIAL_SOURCE,
    operation: "sales_trial.account.create",
    outcome: "success",
    customerId: participant.customerId,
    actor: { type: "sales_trial_participant", id: participant.id, email: participant.email },
    subject: { type: "sales_trial_participant", id: participant.id },
    candidateEmail: participant.email,
    message: "Sales Trial account created",
    details: { workspace: participant.workspace, registrationKind: "demo_only" },
  });
  await deps.audit?.write({
    id: randomUUID(),
    customerId: participant.customerId,
    actorType: "sales_trial_participant",
    actorId: participant.id,
    actorEmail: participant.email,
    action: "sales_trial.account.create",
    subjectType: "sales_trial_participant",
    subjectId: participant.id,
    outcome: "success",
    candidateEmail: participant.email,
    details: { workspace: participant.workspace, source: SALES_TRIAL_SOURCE },
    occurredAt: new Date(deps.now?.() ?? Date.now()),
  });

  return {
    status: 201,
    body: {
      participant: {
        email: participant.email,
        firstName: participant.firstName,
        lastName: participant.lastName,
        role: participant.role,
      },
    },
  };
}

export async function handleSalesTrialLogin(
  deps: SalesTrialPortalDeps,
  request: SalesTrialPortalRequest,
): Promise<SalesTrialPortalResponse> {
  const body = request.body;
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

  const email = (body as { email: string }).email.trim().toLowerCase();
  const password = (body as { password: string }).password;
  const customer = await deps.users.findSalesTrialCustomer();
  if (!customer || !deps.sessions) {
    await recordFailure(deps, email, customer, "sales_trial.login", "sales_trial_unavailable");
    return {
      status: 503,
      body: { error: "Sales Trial sign in is not available right now." },
    };
  }

  try {
    const session = await signInSalesTrialParticipant(deps, customer, email, password);
    await deps.diagnostics?.record({
      level: "info",
      source: SALES_TRIAL_SOURCE,
      operation: "sales_trial.login",
      outcome: "success",
      customerId: session.customerId,
      actor: { type: "sales_trial_participant", id: session.userId, email: session.email },
      subject: { type: "customer", id: session.customerId },
      candidateEmail: session.email,
      message: "Sales Trial participant login succeeded",
      details: { workspace: session.workspace },
    });
    await deps.audit?.write({
      id: randomUUID(),
      customerId: session.customerId,
      actorType: "sales_trial_participant",
      actorId: session.userId,
      actorEmail: session.email,
      action: "sales_trial.login",
      subjectType: "customer",
      subjectId: session.customerId,
      outcome: "success",
      candidateEmail: session.email,
      details: { workspace: session.workspace, source: SALES_TRIAL_SOURCE },
      occurredAt: new Date(deps.now?.() ?? Date.now()),
    });

    return {
      status: 200,
      body: {
        session: {
          email: session.email,
          firstName: session.firstName,
          lastName: session.lastName,
          role: session.role,
        },
      },
      session,
    };
  } catch (error) {
    if (
      error instanceof InvalidPortalCredentialsError ||
      (error instanceof Error && error.name === "InvalidPortalCredentialsError")
    ) {
      await recordFailure(deps, email, customer, "sales_trial.login", "invalid_credentials");
      return {
        status: 401,
        body: { error: "Invalid email or password" },
      };
    }

    throw error;
  }
}

async function signInSalesTrialParticipant(
  deps: SalesTrialPortalDeps,
  customer: PortalCustomerRecord,
  email: string,
  password: string,
): Promise<PortalSession> {
  const user = await deps.users.findByEmail(email, {
    customerId: customer.id,
    role: "sales_trial_participant",
  });
  if (!user) {
    throw new InvalidPortalCredentialsError();
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new InvalidPortalCredentialsError();
  }

  const now = deps.now ?? Date.now;
  const session: PortalSession = {
    sessionId: deps.newSessionId?.() ?? randomUUID(),
    userId: user.id,
    customerId: user.customerId,
    role: user.role,
    workspace: user.workspace ?? "sales",
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    issuedAtMs: now(),
  };
  await deps.sessions!.save(session);
  return session;
}

async function recordFailure(
  deps: SalesTrialPortalDeps,
  email: string,
  customer: PortalCustomerRecord | null,
  action: string,
  reason: string,
): Promise<void> {
  await deps.diagnostics?.record({
    level: "warn",
    source: SALES_TRIAL_SOURCE,
    operation: action,
    outcome: "failure",
    customerId: customer?.id ?? null,
    actor: { type: "sales_trial_participant", email },
    subject: { type: "sales_trial_participant" },
    candidateEmail: email,
    message: "Sales Trial account flow failed",
    details: { reason },
  });
  await deps.audit?.write({
    id: randomUUID(),
    customerId: customer?.id ?? null,
    actorType: "sales_trial_participant",
    actorEmail: email || null,
    action,
    subjectType: "sales_trial_participant",
    outcome: "failure",
    candidateEmail: email || null,
    details: { source: SALES_TRIAL_SOURCE },
    occurredAt: new Date(deps.now?.() ?? Date.now()),
  });
}
