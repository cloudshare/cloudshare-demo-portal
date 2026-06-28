import {
  InvalidPortalCredentialsError,
  type PortalAuthenticator,
  type PortalSession,
  type PortalUserStore,
} from "@/auth";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";
import {
  buildCandidateLogoutAutoSuspendDeps,
  suspendCandidateRunningLabsForLogout,
  type CandidateLogoutAutoSuspendDeps,
  type CandidateLogoutAutoSuspendServices,
} from "./portal-logout-runtime";

export const PORTAL_SESSION_COOKIE = "portal_session";

const AUTH_SOURCE = "auth";

/** Map a portal role to a diagnostic actor type. */
function actorTypeForRole(role: string): string {
  return role === "admin" ? "admin" : "candidate";
}

export interface PortalAuthRequest {
  readonly body?: unknown;
  readonly sessionId?: string;
}

export interface PortalAuthResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly session?: PortalSession;
}

export interface PortalAuthDeps {
  readonly portalAuth: PortalAuthenticator;
  /**
   * Optional support diagnostics. Routes always wire this; unit tests that only
   * exercise auth behaviour may omit it. Recording never throws into this flow.
   */
  readonly diagnostics?: DiagnosticRecorder;
  /**
   * Optional user lookup used only to attribute a FAILED login to its owning
   * Customer (so the failed attempt is visible in that Customer's Support view).
   * Never affects the auth decision; absence simply leaves failures unattributed.
   */
  readonly users?: PortalUserStore;
  /**
   * Candidate runtime cleanup that must happen before the portal session is
   * invalidated. Used to suspend running labs on explicit logout.
   */
  readonly onCandidateLogout?: (session: PortalSession) => Promise<void>;
}

export interface PortalSessionServices {
  readonly portalAuth: PortalAuthenticator;
}

export interface PortalLoginServices extends PortalSessionServices {
  readonly diagnosticRecorder: DiagnosticRecorder;
  readonly portalUsers: PortalUserStore;
}

interface PortalLogoutBuilderOptions {
  readonly buildCandidateLogoutAutoSuspendDeps?: (
    services: CandidateLogoutAutoSuspendServices,
    session: PortalSession,
  ) => CandidateLogoutAutoSuspendDeps;
  readonly suspendCandidateRunningLabsForLogout?: (
    deps: CandidateLogoutAutoSuspendDeps,
    session: PortalSession,
  ) => Promise<void>;
}

export interface PortalLogoutServices
  extends PortalSessionServices,
    CandidateLogoutAutoSuspendServices {
  readonly diagnosticRecorder: DiagnosticRecorder;
}

export function buildPortalSessionDeps(
  services: PortalSessionServices,
): Pick<PortalAuthDeps, "portalAuth"> {
  return {
    portalAuth: services.portalAuth,
  };
}

export function buildPortalLoginDeps(services: PortalLoginServices): PortalAuthDeps {
  return {
    portalAuth: services.portalAuth,
    diagnostics: services.diagnosticRecorder,
    users: services.portalUsers,
  };
}

export function buildPortalLogoutDeps(
  services: PortalLogoutServices,
  options: PortalLogoutBuilderOptions = {},
): PortalAuthDeps {
  const buildRuntimeDeps =
    options.buildCandidateLogoutAutoSuspendDeps ?? buildCandidateLogoutAutoSuspendDeps;
  const suspendRunningLabs =
    options.suspendCandidateRunningLabsForLogout ?? suspendCandidateRunningLabsForLogout;

  return {
    portalAuth: services.portalAuth,
    diagnostics: services.diagnosticRecorder,
    onCandidateLogout: (session) =>
      suspendRunningLabs(buildRuntimeDeps(services, session), session),
  };
}

export async function handlePortalLogin(
  deps: PortalAuthDeps,
  request: PortalAuthRequest,
): Promise<PortalAuthResponse> {
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

  try {
    const session = await deps.portalAuth.signIn(email, password);
    await deps.diagnostics?.record({
      level: "info",
      source: AUTH_SOURCE,
      operation: "portal.login",
      outcome: "success",
      customerId: session.customerId,
      actor: {
        type: actorTypeForRole(session.role),
        id: session.userId,
        email: session.email,
      },
      subject: { type: "customer", id: session.customerId },
      candidateEmail: session.role === "admin" ? null : session.email,
      message: `Portal ${session.role} login succeeded`,
      details: { role: session.role },
    });
    return {
      status: 200,
      body: {
        session: {
          email: session.email,
          role: session.role,
          customerId: session.customerId,
        },
      },
      session,
    };
  } catch (error) {
    const isInvalidCreds =
      error instanceof InvalidPortalCredentialsError ||
      (error instanceof Error && error.name === "InvalidPortalCredentialsError");

    // Attribute the failed attempt to its owning Customer when the email maps to
    // a known user, so the failure is visible in that Customer's Support view.
    // Unknown emails stay unattributed. The lookup never affects auth and never
    // throws into this flow.
    let known: Awaited<ReturnType<PortalUserStore["findByEmail"]>> = null;
    try {
      known = email ? await deps.users?.findByEmail(email) ?? null : null;
    } catch {
      known = null;
    }

    // Always record the failed attempt. We record only the attempted email —
    // never the submitted password.
    await deps.diagnostics?.record({
      level: "warn",
      source: AUTH_SOURCE,
      operation: "portal.login",
      outcome: "failure",
      customerId: known?.customerId ?? null,
      actor: known
        ? { type: actorTypeForRole(known.role), id: known.id, email }
        : { type: "anonymous", email },
      candidateEmail: known && known.role !== "admin" ? email : null,
      message: isInvalidCreds
        ? "Portal login failed: invalid credentials"
        : "Portal login failed: unexpected error",
      details: {
        reason: isInvalidCreds
          ? "invalid_credentials"
          : error instanceof Error
            ? error.name
            : "unexpected_error",
      },
    });

    if (isInvalidCreds) {
      return { status: 401, body: { error: (error as Error).message } };
    }
    throw error;
  }
}

export async function handleGetPortalSession(
  deps: PortalAuthDeps,
  request: PortalAuthRequest,
): Promise<PortalAuthResponse> {
  if (!request.sessionId) {
    return { status: 401, body: { error: "no portal session" } };
  }

  const session = await deps.portalAuth.resume(request.sessionId);
  if (!session) {
    return { status: 401, body: { error: "no portal session" } };
  }

  return {
    status: 200,
    body: {
      session: {
        email: session.email,
        role: session.role,
        customerId: session.customerId,
      },
    },
    session,
  };
}

export async function handlePortalLogout(
  deps: PortalAuthDeps,
  request: PortalAuthRequest,
): Promise<PortalAuthResponse> {
  // Resume before signing out so the diagnostic entry carries the actor's
  // identity (role, customer, email) rather than just an opaque session id.
  let session: PortalSession | null = null;
  try {
    session = request.sessionId
      ? await deps.portalAuth.resume(request.sessionId)
      : null;

    if (session?.role === "candidate") {
      await deps.onCandidateLogout?.(session);
    }

    if (request.sessionId) {
      await deps.portalAuth.signOut(request.sessionId);
    }
  } catch (error) {
    await deps.diagnostics?.record({
      level: "warn",
      source: AUTH_SOURCE,
      operation: "portal.logout",
      outcome: "failure",
      customerId: session?.customerId ?? null,
      actor: session
        ? { type: actorTypeForRole(session.role), id: session.userId, email: session.email }
        : { type: "anonymous" },
      message: "Portal logout failed",
      details: { reason: error instanceof Error ? error.name : "unexpected_error" },
    });
    throw error;
  }

  await deps.diagnostics?.record({
    level: "info",
    source: AUTH_SOURCE,
    operation: "portal.logout",
    outcome: "success",
    customerId: session?.customerId ?? null,
    actor: session
      ? { type: actorTypeForRole(session.role), id: session.userId, email: session.email }
      : { type: "anonymous" },
    subject: session ? { type: "customer", id: session.customerId } : null,
    candidateEmail: session && session.role !== "admin" ? session.email : null,
    message: session
      ? `Portal ${session.role} logout`
      : "Portal logout for unknown or expired session",
  });

  return {
    status: 200,
    body: { ok: true },
  };
}
