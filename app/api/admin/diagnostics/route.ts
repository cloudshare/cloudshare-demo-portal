import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { buildAdminDiagnosticLogDeps, handleGetDiagnosticLog } from "@/api/admin";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

/**
 * GET /api/admin/diagnostics — the typed diagnostic-log read API.
 *
 * Customer scope is taken from the authenticated admin session, never from the
 * query string, so an admin can only read their own Customer's entries.
 */
export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.workspace === "sales") {
    return NextResponse.json({ error: "sales_diagnostics_route_required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  const response = await handleGetDiagnosticLog(
    buildAdminDiagnosticLogDeps(services),
    { query, customerId: session.customerId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
