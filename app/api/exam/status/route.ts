import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { getPortalSession } from "@/auth/portal-session";
import {
  buildCandidateLabStatusDeps,
  handleGetCandidateLabStatus,
} from "@/api/candidate-lab";

export async function GET(request: Request) {
  const examAttemptId = new URL(request.url).searchParams.get("examAttemptId")?.trim();
  if (!examAttemptId) {
    return NextResponse.json({ error: "examAttemptId is required" }, { status: 400 });
  }

  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session || session.role !== "candidate") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await handleGetCandidateLabStatus(
    buildCandidateLabStatusDeps(services),
    {
      examAttemptId,
      candidateId: session.userId,
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
