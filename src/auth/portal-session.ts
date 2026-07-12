import type { PortalAuthenticator } from "./portal-auth";
import type { PortalSession } from "./portal-stores";

export interface PortalSessionDeps {
  readonly portalAuth: Pick<PortalAuthenticator, "resume">;
  readonly ensurePortalSeeded: () => Promise<void>;
}

export async function getPortalSession(
  services: PortalSessionDeps,
  sessionId: string | undefined,
): Promise<PortalSession | null> {
  await services.ensurePortalSeeded();
  if (!sessionId) {
    return null;
  }
  return services.portalAuth.resume(sessionId);
}

export async function getPortalAdminSession(
  services: PortalSessionDeps,
  sessionId: string | undefined,
): Promise<PortalSession | null> {
  const session = await getPortalSession(services, sessionId);
  return session?.role === "admin" ? session : null;
}

export function getPortalHomePath(session: PortalSession | null): string {
  if (!session) {
    return "/login";
  }

  if (session.role !== "admin") {
    return "/candidate";
  }
  return session.workspace === "sales" ? "/sales" : "/admin";
}
