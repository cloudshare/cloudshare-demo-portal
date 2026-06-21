import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleCreateDraftExam, handleGetExamCatalog } from "@/api/admin-exams";

export async function GET() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await handleGetExamCatalog(
    { repository: services.exams, logger: services.logger },
    { customerId: session.customerId },
  );
  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(request: Request) {
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

  const response = await handleCreateDraftExam(
    {
      repository: services.exams,
      cache: services.examAuthoringCache,
      instructor: services.config.seed.heliosInstructor,
      diagnostics: services.diagnosticRecorder,
      logger: services.logger,
    },
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      body,
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
