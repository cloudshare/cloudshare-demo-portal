import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleCandidateCompleteExamRoute } from "@/api/candidate-early-completion-route";
import { getPortalSession } from "@/auth/portal-session";

/**
 * Candidate-initiated early exam completion. For running labs, the framework
 * handler first confirms CloudShare cleanup through the existing suspend/poll
 * path before persisting the ExamAttempt as completed.
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

  const resp = await handleCandidateCompleteExamRoute(services, {
    sessionId,
    body,
    getPortalSession: getCurrentPortalSession,
  });

  return NextResponse.json(resp.body, { status: resp.status });
}
