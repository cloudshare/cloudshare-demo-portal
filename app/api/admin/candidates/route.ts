import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getAdminCandidateServices,
  getCandidateRegistrationServices,
  getPortalSessionServices,
} from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildCandidateRegistrationDeps,
  handleAdminCreateCandidate,
} from "@/api/candidate-portal";
import {
  buildAdminCandidateDeps,
  handleGetAdminCandidateRoster,
} from "@/api/admin-candidates";

export async function GET(request: Request) {
  const portalSessionServices = getPortalSessionServices();
  await portalSessionServices.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const response = await handleGetAdminCandidateRoster(
    buildAdminCandidateDeps(getAdminCandidateServices()),
    {
      customerId: session.customerId,
      query: {
        search: searchParams.get("search") ?? undefined,
      },
    },
  );

  return NextResponse.json(response.body, { status: response.status });
}

export async function POST(request: Request) {
  const portalSessionServices = getPortalSessionServices();
  await portalSessionServices.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const response = await handleAdminCreateCandidate(
    buildCandidateRegistrationDeps(getCandidateRegistrationServices()),
    { customerId: session.customerId, body },
  );

  return NextResponse.json(response.body, { status: response.status });
}
