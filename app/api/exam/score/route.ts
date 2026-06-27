import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { buildCandidateScoreDeps, handleGetCandidateScore } from "@/api/score";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

/**
 * Retrieve the candidate's Guided Journey score for an exam attempt.
 * Returns either a mapped score payload or a candidate-safe "no score available"
 * result, plus CloudShare scoring limitation disclaimers. Query param:
 * examAttemptId
 */
export async function GET(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  const { searchParams } = new URL(request.url);
  const query: Record<string, string | undefined> = {};
  searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);

  const resp = await handleGetCandidateScore(
    buildCandidateScoreDeps(services),
    { query, session },
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
