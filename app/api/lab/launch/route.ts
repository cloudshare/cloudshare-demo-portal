import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { launchLab } from "@/domain/lab-launch";
import { LabLaunchError, NotEntitledError } from "@/domain/errors";

/**
 * Launch the CloudShare lab for an ExamAttempt. Entitlement is recomputed
 * server-side inside `launchLab` from persisted state — the request carries only
 * the examAttemptId, never an entitlement claim. Returns the Classic-domain
 * loginUrl the candidate opens in a child window.
 */
export async function POST(request: Request) {
  const { labProvisioner, labLaunches, examAttempts, logger } = getServices();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const { examAttemptId } = body as { examAttemptId?: unknown };
  if (typeof examAttemptId !== "string") {
    return NextResponse.json({ error: "examAttemptId is required" }, { status: 400 });
  }

  try {
    const launch = await launchLab(
      {
        attempts: examAttempts,
        labs: labProvisioner,
        launches: labLaunches,
        newId: () => randomUUID(),
        newExternalId: () => randomUUID(),
        now: () => new Date(),
      },
      { examAttemptId },
    );
    logger.info("lab launched", {
      examAttemptId,
      environmentExternalId: launch.environmentExternalId,
    });
    return NextResponse.json(
      {
        examAttemptId,
        loginUrl: launch.loginUrl,
        environmentExternalId: launch.environmentExternalId,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof NotEntitledError) {
      return NextResponse.json({ error: "not entitled to launch a lab" }, { status: 403 });
    }
    if (err instanceof LabLaunchError) {
      // Upstream provisioning failed (e.g. Add Student). Actionable, not a silent denial.
      logger.error("lab launch failed", { examAttemptId, ...(err.context ?? {}) });
      return NextResponse.json({ error: "lab provisioning failed" }, { status: 502 });
    }
    logger.error("lab launch errored", {
      examAttemptId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
