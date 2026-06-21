import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleHeartbeat } from "@/api/heartbeat";
import { authorizeCandidateExamAttemptAccess } from "@/api/candidate-exam-attempt-access";
import { reconcileExamAttemptCompletion } from "@/domain/exam-attempt-completion";
import { getPortalSession } from "@/auth/portal-session";

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
  });
  if (!access.ok) {
    return NextResponse.json(access.response.body, { status: access.response.status });
  }

  const portalSession = await getPortalSession(services, sessionId);

  const reconciliation = await reconcileExamAttemptCompletion(
    {
      attempts: services.examAttempts,
      exams: services.exams,
      clocks: services.examClock,
    },
    { examAttemptId },
  );
  if (reconciliation?.status === "completed") {
    heartbeatAutoSuspend.removeHeartbeat(examAttemptId);
    await services.diagnosticRecorder.record({
      source: "runtime",
      customerId: access.attempt.customerId ?? null,
      candidateEmail: portalSession?.email ?? null,
      examId: access.attempt.examId ?? null,
      examAttemptId,
      level: "info",
      operation: "exam_attempt.completed",
      outcome: "success",
      message: "Exam attempt completed (heartbeat reconciliation)",
      actor: { type: "candidate", id: access.attempt.candidateId ?? null, email: portalSession?.email ?? null },
      subject: { type: "exam_attempt", id: examAttemptId },
      details: { reason: "heartbeat_reconciliation" },
    });
    return NextResponse.json(
      { status: "completed", attemptStatus: "completed" },
      { status: 200 },
    );
  }

  if (access.attempt.status !== "in_progress") {
    return NextResponse.json({ error: "exam attempt is not in progress" }, { status: 409 });
  }

  const resp = await handleHeartbeat({ autoSuspend: heartbeatAutoSuspend, logger }, { body });
  await services.diagnosticRecorder.record({
    source: "runtime",
    customerId: access.attempt.customerId ?? null,
    candidateEmail: portalSession?.email ?? null,
    examId: access.attempt.examId ?? null,
    examAttemptId,
    level: "info",
    operation: "exam_attempt.heartbeat.receive",
    outcome: "success",
    message: "Heartbeat received for in-progress exam attempt",
    actor: { type: "candidate", id: access.attempt.candidateId ?? null, email: portalSession?.email ?? null },
    subject: { type: "exam_attempt", id: examAttemptId },
    details: { route: "/api/heartbeat" },
  });
  return NextResponse.json(
    {
      ...resp.body,
      attemptStatus: "in_progress",
    },
    { status: resp.status },
  );
}
