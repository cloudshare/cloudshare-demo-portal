import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import {
  handlePortalLogout,
  PORTAL_SESSION_COOKIE,
} from "@/api/portal-auth";
import { handleSuspendExam } from "@/api/suspend-resume";
import { suspendCandidateRunningLabsForLogout } from "@/api/portal-logout-runtime";

export async function POST() {
  const services = getServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  await handlePortalLogout(
    {
      portalAuth: services.portalAuth,
      diagnostics: services.diagnosticRecorder,
      onCandidateLogout: (session) =>
        suspendCandidateRunningLabsForLogout(
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
            suspendExam: handleSuspendExam,
            heartbeatAutoSuspend: services.heartbeatAutoSuspend,
            audit: services.audit,
            newId: randomUUID,
            now: () => new Date(),
          },
          session,
        ),
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
