import { NextResponse } from "next/server";
import { getServices } from "@/composition";

/**
 * List the exams a candidate is eligible to book. Drives the self-service
 * booking screen — the Genesys simulator decides eligibility from prerequisite
 * training.
 */
export async function GET(request: Request) {
  const { genesys, logger } = getServices();

  const candidateId = new URL(request.url).searchParams.get("candidateId");
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }

  try {
    const exams = await genesys.listEligibleExams(candidateId);
    return NextResponse.json({ exams });
  } catch (err) {
    logger.error("listing eligible exams failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
