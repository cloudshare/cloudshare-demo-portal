import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getAdminCohortExamSessionServices, getPortalSessionServices } from "@/composition";
import {
  buildAdminCohortExamSessionDeps,
  handleCreateDraftCohortExamSession,
  handleListCohortExamSessions,
} from "@/api/admin-cohort-exam-sessions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examId: string }> },
) {
  const portalSessionServices = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { examId } = await context.params;
  const response = await handleListCohortExamSessions(
    buildAdminCohortExamSessionDeps(getAdminCohortExamSessionServices()),
    { customerId: session.customerId, examId },
  );
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ examId: string }> },
) {
  const portalSessionServices = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { examId } = await context.params;
  const response = await handleCreateDraftCohortExamSession(
    buildAdminCohortExamSessionDeps(getAdminCohortExamSessionServices()),
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      examId,
      body,
    },
  );
  return NextResponse.json(response.body, { status: response.status });
}
