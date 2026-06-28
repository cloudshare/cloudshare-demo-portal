import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleCandidateResumeExamRoute } from "@/api/candidate-suspend-resume-route";
import { getPortalSession } from "@/auth/portal-session";

/**
 * Candidate-initiated lab resume. Resumes the CloudShare environment, refreshes
 * the sponsored link server-side, and resumes the portal-owned exam clock.
 * The refreshed link stays server-only; the candidate re-enters through `/enter`.
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

  const resp = await handleCandidateResumeExamRoute(services, {
    sessionId,
    body,
    getPortalSession: getCurrentPortalSession,
  });

  return NextResponse.json(resp.body, { status: resp.status });
}
