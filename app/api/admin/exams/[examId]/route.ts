import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminDraftExamUpdateDeps, handleUpdateDraftExam } from "@/api/admin-exams";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ examId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
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
  const response = await handleUpdateDraftExam(
    buildAdminDraftExamUpdateDeps(services),
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      examId,
      body,
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
