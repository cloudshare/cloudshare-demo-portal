import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getAdminCohortExamSessionServices, getPortalSessionServices } from "@/composition";
import {
  buildAdminCohortExamSessionDeps,
  handlePublishCohortExamSession,
} from "@/api/admin-cohort-exam-sessions";

export async function POST(
  _request: Request,
  context: { params: Promise<{ examId: string; sessionId: string }> },
) {
  const portalSessionServices = getPortalSessionServices();
  const sessionCookie = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionCookie);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { examId, sessionId } = await context.params;
  const response = await handlePublishCohortExamSession(
    buildAdminCohortExamSessionDeps(getAdminCohortExamSessionServices()),
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      examId,
      sessionId,
    },
  );
  return NextResponse.json(response.body, { status: response.status });
}
