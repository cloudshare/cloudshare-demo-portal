import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import {
  buildAdminExamAttemptDiagnosticDrilldownDeps,
  handleGetAdminExamAttemptDiagnosticDrilldown,
} from "@/api/admin-exam-attempt-diagnostics";

export async function GET(
  _request: Request,
  context: { params: Promise<{ examAttemptId: string }> },
) {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { examAttemptId } = await context.params;
  const response = await handleGetAdminExamAttemptDiagnosticDrilldown(
    buildAdminExamAttemptDiagnosticDrilldownDeps(services),
    { customerId: session.customerId, examAttemptId },
  );

  return NextResponse.json(response.body, { status: response.status });
}
