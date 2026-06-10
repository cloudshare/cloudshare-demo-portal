import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handleRetrieveScore } from "@/api/score";
import { SCORING_LIMITATIONS } from "@/integrations/cloudshare/guided-journey";

/**
 * Retrieve the candidate's Guided Journey score for an exam attempt.
 * Returns ScoreResult plus CloudShare scoring limitation disclaimers.
 * Query param: examAttemptId
 */
export async function GET(request: Request) {
  const { labLaunches, scoreRetriever, logger } = getServices();
  const { searchParams } = new URL(request.url);
  const query: Record<string, string | undefined> = {};
  searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const resp = await handleRetrieveScore(
    { launches: labLaunches, scoreRetriever, logger, limitations: SCORING_LIMITATIONS },
    { query },
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
