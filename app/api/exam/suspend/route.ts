import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleSuspendExam } from "@/api/suspend-resume";
import type { AuditRecord } from "@/domain/audit-trail";

/**
 * Candidate-initiated lab suspend. Suspends the CloudShare environment and
 * pauses the Kryterion authoritative exam timer once `Suspended` is confirmed
 * by polling. The request body must contain `examAttemptId`.
 */
export async function POST(request: Request) {
  const { environmentSource, environmentController, examAttempts, labLaunches, examClock, logger, heartbeatAutoSuspend, audit } =
    getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const resp = await handleSuspendExam(
    {
      controller: environmentController,
      source: environmentSource,
      timer: examClock,
      attempts: examAttempts,
      launches: labLaunches,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      logger,
    },
    { body },
  );

  const parsed = body as { examAttemptId?: unknown };
  const examAttemptId = typeof parsed.examAttemptId === "string" ? parsed.examAttemptId : undefined;

  if (resp.status === 200) {
    if (examAttemptId) heartbeatAutoSuspend.removeHeartbeat(examAttemptId);
    if (examAttemptId) {
      await audit.write({
        id: randomUUID(),
        examAttemptId,
        action: "lab_suspended",
        outcome: "success",
        occurredAt: new Date(),
      } satisfies AuditRecord);
    }
  } else if (resp.status >= 500 && examAttemptId) {
    await audit.write({
      id: randomUUID(),
      examAttemptId,
      action: "lab_suspend_failed",
      outcome: "failure",
      error: typeof resp.body.error === "string" ? resp.body.error : "suspend failed",
      occurredAt: new Date(),
    } satisfies AuditRecord);
  }

  return NextResponse.json(resp.body, { status: resp.status });
}
