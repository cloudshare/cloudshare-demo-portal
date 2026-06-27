import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminMonitoringDeps, handleGetAdminMonitoring } from "@/api/admin-monitoring";

export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);

  const response = await handleGetAdminMonitoring(
    buildAdminMonitoringDeps(services),
    {
      customerId: session.customerId,
      query: {
        historyLimit: searchParams.get("historyLimit") ?? undefined,
        historyOffset: searchParams.get("historyOffset") ?? undefined,
      },
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
