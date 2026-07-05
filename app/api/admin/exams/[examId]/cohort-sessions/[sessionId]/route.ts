import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getServices } from "@/composition";
import {
  buildAdminCohortExamSessionDeps,
  handleGetCohortExamSession,
} from "@/api/admin-cohort-exam-sessions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examId: string; sessionId: string }> },
) {
  const services = getServices();
  const sessionCookie = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionCookie);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { examId, sessionId } = await context.params;
  const response = await handleGetCohortExamSession(
    buildAdminCohortExamSessionDeps(services),
    { customerId: session.customerId, examId, sessionId },
  );
  return NextResponse.json(response.body, { status: response.status });
}
