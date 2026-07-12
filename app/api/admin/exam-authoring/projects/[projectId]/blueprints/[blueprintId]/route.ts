import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminExamAuthoringServices, getPortalSessionServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildAdminExamAuthoringDeps,
  handleGetBlueprintDetail,
} from "@/api/admin-exams";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; blueprintId: string }> },
) {
  const portalSessionServices = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") === "true";
  const { projectId, blueprintId } = await context.params;
  const response = await handleGetBlueprintDetail(
    buildAdminExamAuthoringDeps(getAdminExamAuthoringServices()),
    { customerId: session.customerId, projectId, blueprintId, refresh },
  );

  return NextResponse.json(response.body, { status: response.status });
}
