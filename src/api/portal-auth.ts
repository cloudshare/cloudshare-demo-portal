import {
  InvalidPortalCredentialsError,
  type PortalAuthenticator,
  type PortalSession,
} from "@/auth";

export const PORTAL_SESSION_COOKIE = "portal_session";

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
