import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildAdminExamArchiveDeps, handleArchiveExam } from "@/api/admin-exams";
import { createPrismaAdminExamArchiveAttemptRepository } from "@/persistence/prisma-admin-exam-archive-attempt-repository";

export async function POST(
  request: Request,
  context: { params: Promise<{ examId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { examId } = await context.params;
  const response = await handleArchiveExam(
    buildAdminExamArchiveDeps({
      exams: services.exams,
      adminExamArchiveAttempts: createPrismaAdminExamArchiveAttemptRepository(services.prisma),
      diagnosticRecorder: services.diagnosticRecorder,
      audit: services.audit,
      logger: services.logger,
    }),
    {
      customerId: session.customerId,
      actor: { type: "admin", id: session.userId, email: session.email },
      examId,
      body,
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
