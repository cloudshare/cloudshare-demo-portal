import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildCandidateCohortJoinDeps,
  handleJoinCandidateCohortExamSession,
} from "@/api/candidate-portal";

export async function POST(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session || session.role !== "candidate") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const response = await handleJoinCandidateCohortExamSession(
    buildCandidateCohortJoinDeps(services),
    {
      customerId: session.customerId,
      candidateId: session.userId,
      candidateEmail: session.email,
      candidateFirstName: session.firstName,
      candidateLastName: session.lastName,
      body,
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}
