import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { AuthError } from "@/auth";

/**
 * Admit a candidate from a Kryterion single-use exam token. On success, sets an
 * httpOnly session cookie so the candidate is remembered across page reloads,
 * and returns the bound ExamAttempt. Denials are 401s; the raw reason stays in
 * the (redacted) logs, not the response.
 */
export async function POST(request: Request) {
  const { candidateAuth, logger } = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string" || token.length === 0) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  try {
    const session = await candidateAuth.admit(token);
    const response = NextResponse.json({
      examAttemptId: session.examAttemptId,
      candidateId: session.candidateId,
    });
    response.cookies.set("candidate_session", session.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      logger.warn("candidate admission denied", { reason: err.name });
      return NextResponse.json({ error: "admission denied" }, { status: 401 });
    }
    logger.error("candidate admission failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
