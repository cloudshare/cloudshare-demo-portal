import type { Services } from "@/composition";
import type { PortalSession } from "./portal-stores";

export async function getPortalSession(
  services: Services,
  sessionId: string | undefined,
): Promise<PortalSession | null> {
  await services.ensurePortalSeeded();
  if (!sessionId) {
    return null;
  }
  return services.portalAuth.resume(sessionId);
}

export async function getPortalAdminSession(
  services: Services,
  sessionId: string | undefined,
): Promise<PortalSession | null> {
  const session = await getPortalSession(services, sessionId);
  return session?.role === "admin" ? session : null;
}
