import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { buildAdminDiagnosticLogDeps } from "@/api/admin";
import { handleGetSalesDiagnosticLog } from "@/api/sales-diagnostics";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

/** GET /api/sales/diagnostics — Sales-only, local-record diagnostic evidence. */
export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session || session.workspace !== "sales") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const response = await handleGetSalesDiagnosticLog(
    buildAdminDiagnosticLogDeps(services),
    { query, customerId: session.customerId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
