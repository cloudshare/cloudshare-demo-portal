import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleResumeExam } from "@/api/suspend-resume";

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

  return NextResponse.json(resp.body, { status: resp.status });
}
