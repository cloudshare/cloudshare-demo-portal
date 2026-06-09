import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleSuspendExam } from "@/api/suspend-resume";

/**
 * Candidate-initiated lab suspend. Suspends the CloudShare environment and
 * pauses the Kryterion authoritative exam timer once `Suspended` is confirmed
 * by polling. The request body must contain `examAttemptId`.
 */
export async function POST(request: Request) {
  const { environmentSource, environmentController, labLaunches, kryterion, logger } =
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
      timer: kryterion,
      launches: labLaunches,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      logger,
    },
    { body },
  );

  return NextResponse.json(resp.body, { status: resp.status });
}
