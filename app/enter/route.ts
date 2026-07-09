import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildEnterExamBlockedPage, handleEnterExam } from "@/api/enter";

export async function GET(request: Request) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);

  if (!session || session.role !== "candidate") {
    return new NextResponse("Unauthorized.", {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const examAttemptId = new URL(request.url).searchParams.get("examAttemptId")?.trim();
  if (!examAttemptId) {
    return new NextResponse("examAttemptId is required.", {
      status: 400,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const response = await handleEnterExam(
    {
      attempts: services.examAttempts,
      exams: services.exams,
      clocks: services.examClock,
      launches: services.labLaunches,
      connections: services.cloudshareConnections,
      cloudshare: services.cloudshareClientFactory,
      timer: services.examClock,
      logger: services.logger,
      diagnostics: services.diagnosticRecorder,
      candidateEmail: session.email ?? undefined,
    },
    {
      examAttemptId,
      candidateId: session.userId,
    },
  );

  if (response.status >= 400) {
    return new NextResponse(
      buildEnterExamBlockedPage({
        examAttemptId,
        status: response.status,
        message: response.body,
      }),
      {
        status: response.status,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      },
    );
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
