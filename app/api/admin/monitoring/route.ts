import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleGetAdminMonitoring } from "@/api/admin-monitoring";

export async function GET(_request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await handleGetAdminMonitoring(
    {
      attempts: services.adminMonitoringAttempts,
      audit: services.audit,
      eventLog: services.eventLog,
      logger: services.logger,
    },
    { customerId: session.customerId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
