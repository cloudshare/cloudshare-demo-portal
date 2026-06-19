import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { handleGetCandidateScore } from "@/api/score";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  createCloudShareGuidedJourneyProvider,
  SCORING_LIMITATIONS,
} from "@/integrations/cloudshare/guided-journey";
import { createCloudShareParticipantLister } from "@/integrations/cloudshare/participants";

/**
 * Retrieve the candidate's Guided Journey score for an exam attempt.
 * Returns either a mapped score payload or a candidate-safe "no score available"
 * result, plus CloudShare scoring limitation disclaimers. Query param:
 * examAttemptId
 */
export async function GET(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  const { searchParams } = new URL(request.url);
  const query: Record<string, string | undefined> = {};
  searchParams.forEach((value, key) => {
    query[key] = value;
  });
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);

  const resp = await handleGetCandidateScore(
    {
      attempts: services.examAttempts,
      exams: services.exams,
      launches: services.labLaunches,
      audit: services.audit,
      connections: services.cloudshareConnections,
      createScoreRetriever: (connection) =>
        createCloudShareGuidedJourneyProvider(
          services.cloudshareClientFactory.forConnection(connection),
        ),
      createParticipantLister: (connection) =>
        createCloudShareParticipantLister(
          services.cloudshareClientFactory.forConnection(connection),
        ),
      logger: services.logger,
      limitations: SCORING_LIMITATIONS,
    },
    { query, session },
  );
  return NextResponse.json(resp.body, { status: resp.status });
}
