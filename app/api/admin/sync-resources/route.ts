import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { handleSyncResources } from "@/api/admin";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

/** POST /api/admin/sync-resources — fetches CloudShare resource lists and caches them in-memory. */
export async function POST() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { cloudshareConnections, cloudshareClientFactory, resources, logger } = services;

  const resp = await handleSyncResources(
    {
      connections: cloudshareConnections,
      cloudshare: cloudshareClientFactory,
      resources,
      logger,
    },
    { customerId: session.customerId },
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
