import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleUnpublishExam } from "@/api/admin-exams";

export async function POST(
  _request: Request,
  context: { params: Promise<{ examId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { examId } = await context.params;
  const response = await handleUnpublishExam(
    {
      repository: services.exams,
      logger: services.logger,
    },
    { customerId: session.customerId, examId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
