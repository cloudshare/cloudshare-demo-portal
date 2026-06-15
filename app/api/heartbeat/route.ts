import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleHeartbeat } from "@/api/heartbeat";
import { authorizeCandidateExamAttemptAccess } from "@/api/candidate-exam-attempt-access";

/**
 * Client heartbeat endpoint. The candidate page POSTs here while a lab is
 * open so the server can detect inactivity and auto-suspend the environment.
 * The request body must contain `examAttemptId`.
 */
export async function POST(request: Request) {
  const services = getServices();
  const { heartbeatAutoSuspend, logger } = services;

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
  const access = await authorizeCandidateExamAttemptAccess(services, {
    sessionId,
    examAttemptId,
    requireLaunch: true,
    requireInProgress: true,
  });
  if (!access.ok) {
    return NextResponse.json(access.response.body, { status: access.response.status });
  }

  const resp = await handleHeartbeat({ autoSuspend: heartbeatAutoSuspend, logger }, { body });
  return NextResponse.json(resp.body, { status: resp.status });
}
