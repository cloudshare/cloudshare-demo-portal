import {
  InvalidPortalCredentialsError,
  type PortalAuthenticator,
  type PortalSession,
} from "@/auth";
import type { DiagnosticRecorder } from "@/domain/diagnostic-log";

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
    if (
      error instanceof InvalidPortalCredentialsError ||
      (error instanceof Error && error.name === "InvalidPortalCredentialsError")
    ) {
      // Failed attempt: identity is unverified, so the actor is anonymous and we
      // record only the attempted email — never the submitted password.
      await deps.diagnostics?.record({
        level: "warn",
        source: AUTH_SOURCE,
        operation: "portal.login",
        outcome: "failure",
        actor: { type: "anonymous", email },
        message: "Portal login failed: invalid credentials",
        details: { reason: "invalid_credentials" },
      });
      return { status: 401, body: { error: error.message } };
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
  const session = request.sessionId
    ? await deps.portalAuth.resume(request.sessionId)
    : null;

  if (request.sessionId) {
    await deps.portalAuth.signOut(request.sessionId);
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
