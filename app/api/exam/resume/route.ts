import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleResumeExam } from "@/api/suspend-resume";
import type { AuditRecord } from "@/domain/audit-trail";

/**
 * Candidate-initiated lab resume. Resumes the CloudShare environment, waits
 * until `Running` is confirmed by polling, restarts the Kryterion exam timer,
 * and returns a fresh sponsored-link `loginUrl` so the candidate can reopen
 * the preserved session. The request body must contain `examAttemptId`.
 */
export async function POST(request: Request) {
  const {
    environmentSource,
    environmentController,
    labLaunches,
    labProvisioner,
    kryterion,
    logger,
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
      timer: kryterion,
      launches: labLaunches,
      labs: labProvisioner,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      logger,
    },
    { body },
  );

  const parsed = body as { examAttemptId?: unknown };
  const examAttemptId = typeof parsed.examAttemptId === "string" ? parsed.examAttemptId : undefined;

  if (resp.status === 200) {
    await audit.write({
      id: randomUUID(),
      examAttemptId: examAttemptId ?? "unknown",
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
