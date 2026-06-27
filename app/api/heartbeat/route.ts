import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { buildExamAttemptHeartbeatDeps, handleExamAttemptHeartbeat } from "@/api/heartbeat";
import { authorizeCandidateExamAttemptAccess } from "@/api/candidate-exam-attempt-access";
import { getPortalSession } from "@/auth/portal-session";

/**
 * Client heartbeat endpoint. The candidate page POSTs here while a lab is
 * open so the server can detect inactivity and auto-suspend the environment.
 * The request body must contain `examAttemptId`.
 */
export async function POST(request: Request) {
  const services = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = body as { examAttemptId?: unknown };
  const examAttemptId = typeof parsed.examAttemptId === "string" ? parsed.examAttemptId : undefined;
  if (!examAttemptId) {
    return NextResponse.json({ error: "examAttemptId is required" }, { status: 400 });
  }

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const getCurrentPortalSession = (currentSessionId: string | undefined) =>
    getPortalSession(services, currentSessionId);
  const access = await authorizeCandidateExamAttemptAccess({
    getPortalSession: getCurrentPortalSession,
    examAttempts: services.examAttempts,
    labLaunches: services.labLaunches,
  }, {
    sessionId,
    examAttemptId,
    requireLaunch: true,
  });
  if (!access.ok) {
    return NextResponse.json(access.response.body, { status: access.response.status });
  }

  const portalSession = await getCurrentPortalSession(sessionId);

  const resp = await handleExamAttemptHeartbeat(
    buildExamAttemptHeartbeatDeps(services, {
      candidateEmail: portalSession?.email ?? undefined,
    }),
    {
      examAttemptId,
      candidateId: access.attempt.candidateId,
      launch: access.launch,
    },
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
