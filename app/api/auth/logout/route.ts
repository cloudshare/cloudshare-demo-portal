import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices, type Services } from "@/composition";
import {
  handlePortalLogout,
  PORTAL_SESSION_COOKIE,
} from "@/api/portal-auth";
import type { PortalSession } from "@/auth";
import { handleSuspendExam } from "@/api/suspend-resume";
import type { AuditRecord } from "@/domain/audit-trail";

export async function POST() {
  const services = getServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  await handlePortalLogout(
    {
      portalAuth: services.portalAuth,
      diagnostics: services.diagnosticRecorder,
      onCandidateLogout: (session) => suspendCandidateRunningLabsForLogout(services, session),
    },
    { sessionId },
  );

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(PORTAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return response;
}

async function suspendCandidateRunningLabsForLogout(
  services: Services,
  session: PortalSession,
): Promise<void> {
  const attempts = await services.examAttempts.listByCandidate(session.userId);
  const runningAttempts = attempts.filter((attempt) => attempt.status === "in_progress");

  for (const attempt of runningAttempts) {
    const resp = await handleSuspendExam(
      {
        controller: services.environmentController,
        source: services.environmentSource,
        timer: services.examClock,
        exams: services.exams,
        clocks: services.examClock,
        attempts: services.examAttempts,
        launches: services.labLaunches,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        logger: services.logger,
        eventLog: services.eventLog,
        connections: services.cloudshareConnections,
        cloudshare: services.cloudshareClientFactory,
        diagnostics: services.diagnosticRecorder,
        candidateEmail: session.email ?? undefined,
      },
      { body: { examAttemptId: attempt.id } },
    );

    if (resp.status !== 200) {
      throw new Error(
        `Logout auto-suspend failed for ExamAttempt ${attempt.id}: ${JSON.stringify(resp.body)}`,
      );
    }

    services.heartbeatAutoSuspend.removeHeartbeat(attempt.id);
    await services.audit.write({
      id: randomUUID(),
      examAttemptId: attempt.id,
      candidateId: session.userId,
      action: "lab_suspended",
      outcome: "success",
      details: { reason: "candidate_logout" },
      occurredAt: new Date(),
    } satisfies AuditRecord);
  }
}
