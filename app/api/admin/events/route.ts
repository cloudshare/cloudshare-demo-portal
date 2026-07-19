import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { buildAdminEventLogDeps, handleGetEventLog } from "@/api/admin";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

/** GET /api/admin/events?limit=<n> — returns the integration event log, newest-first. */
export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());

  const resp = await handleGetEventLog(buildAdminEventLogDeps(services), {
    customerId: session.customerId,
    query,
  });
  return NextResponse.json(resp.body, { status: resp.status });
}
