import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getAdminCandidateServices,
  getPortalSessionServices,
} from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildAdminCandidateDeps,
  handleGetAdminCandidateDetail,
} from "@/api/admin-candidates";

export async function GET(
  _request: Request,
  context: { params: Promise<{ candidateId: string }> },
) {
  const portalSessionServices = getPortalSessionServices();
  await portalSessionServices.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(portalSessionServices, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { candidateId } = await context.params;
  const response = await handleGetAdminCandidateDetail(
    buildAdminCandidateDeps(getAdminCandidateServices()),
    { customerId: session.customerId, candidateId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
