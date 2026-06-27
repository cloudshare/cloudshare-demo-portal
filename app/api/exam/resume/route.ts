import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleResumeExam } from "@/api/suspend-resume";
import { authorizeCandidateExamAttemptAccess } from "@/api/candidate-exam-attempt-access";
import { getPortalSession } from "@/auth/portal-session";
import type { AuditRecord } from "@/domain/audit-trail";

/**
 * Candidate-initiated lab resume. Resumes the CloudShare environment, refreshes
 * the sponsored link server-side, and resumes the portal-owned exam clock.
 * The refreshed link stays server-only; the candidate re-enters through `/enter`.
 */
export async function POST(request: Request) {
  const services = getServices();
  const {
    environmentSource,
    environmentController,
    examAttempts,
    labLaunches,
    labProvisioner,
    examClock,
    logger,
    heartbeatAutoSuspend,
    audit,
    eventLog,
    cloudshareConnections,
    cloudshareClientFactory,
  } = services;

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
  const session = await getCurrentPortalSession(sessionId);
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

  const resp = await handleResumeExam(
    {
      controller: environmentController,
      source: environmentSource,
      timer: examClock,
      exams: services.exams,
      clocks: examClock,
      attempts: examAttempts,
      launches: labLaunches,
      labs: labProvisioner,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      logger,
      eventLog,
      connections: cloudshareConnections,
      cloudshare: cloudshareClientFactory,
      diagnostics: services.diagnosticRecorder,
      candidateEmail: session?.email ?? undefined,
    },
    { body },
  );

  const resumeDisposition =
    typeof resp.body.resumeDisposition === "string" ? resp.body.resumeDisposition : null;

  if (resp.status === 200 && examAttemptId && resumeDisposition === "resumed") {
    heartbeatAutoSuspend.removeHeartbeat(examAttemptId);
    await audit.write({
      id: randomUUID(),
      examAttemptId,
      action: "lab_resumed",
      outcome: "success",
      occurredAt: new Date(),
    } satisfies AuditRecord);
  } else if (resp.status >= 500 && examAttemptId) {
    await audit.write({
      id: randomUUID(),
      examAttemptId,
      action: "lab_resume_failed",
      outcome: "failure",
      error: typeof resp.body.error === "string" ? resp.body.error : "resume failed",
      occurredAt: new Date(),
    } satisfies AuditRecord);
  }

  return NextResponse.json(resp.body, { status: resp.status });
}
