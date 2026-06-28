import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildAdminExamAuthoringDeps,
  handleGetExamAuthoringBootstrap,
} from "@/api/admin-exams";

export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "true";
  const response = await handleGetExamAuthoringBootstrap(
    buildAdminExamAuthoringDeps(services),
    { customerId: session.customerId, refresh },
  );

  return NextResponse.json(response.body, { status: response.status });
}
