import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleResumeExam } from "@/api/suspend-resume";
import type { AuditRecord } from "@/domain/audit-trail";

/**
 * Candidate-initiated lab resume. Resumes the CloudShare environment, refreshes
 * the sponsored link server-side, and resumes the portal-owned exam clock.
 * The refreshed link stays server-only; the candidate re-enters through `/enter`.
 */
export async function POST(request: Request) {
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
  } = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const resp = await handleResumeExam(
    {
      controller: environmentController,
      source: environmentSource,
      timer: examClock,
      attempts: examAttempts,
      launches: labLaunches,
      labs: labProvisioner,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      logger,
    },
    { body },
  );

  const parsed = body as { examAttemptId?: unknown };
  const examAttemptId = typeof parsed.examAttemptId === "string" ? parsed.examAttemptId : undefined;

  if (resp.status === 200 && examAttemptId) {
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
