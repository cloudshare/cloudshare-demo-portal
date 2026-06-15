import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { handleGetCandidateExamCatalog } from "@/api/candidate-portal";

export async function GET() {
  const services = getServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session || session.role !== "candidate") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await handleGetCandidateExamCatalog(
    { repository: services.exams, logger: services.logger },
    { customerId: session.customerId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
