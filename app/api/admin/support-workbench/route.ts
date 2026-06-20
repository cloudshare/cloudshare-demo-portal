import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { handleGetSupportWorkbench } from "@/api/support-workbench";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const response = await handleGetSupportWorkbench(
    {
      attempts: services.adminMonitoringAttempts,
      audit: services.audit,
      eventLog: services.eventLog,
      supportLog: services.supportLog,
      logger: services.logger,
    },
    { customerId: session.customerId, query },
  );

  return NextResponse.json(response.body, { status: response.status });
}
