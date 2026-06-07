import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";

/**
 * Resume the current candidate session from the httpOnly cookie. This is what
 * makes a candidate's ExamAttempt survive a page reload. Returns 401 when there
 * is no cookie or the session is unknown.
 */
export async function GET() {
  const { candidateAuth } = getServices();

  const sessionId = (await cookies()).get("candidate_session")?.value;
  if (!sessionId) {
    return NextResponse.json({ error: "no candidate session" }, { status: 401 });
  }

  const session = await candidateAuth.resume(sessionId);
  if (!session) {
    return NextResponse.json({ error: "no candidate session" }, { status: 401 });
  }

  return NextResponse.json({
    examAttemptId: session.examAttemptId,
    candidateId: session.candidateId,
  });
}
