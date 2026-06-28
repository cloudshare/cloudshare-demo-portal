import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import {
  buildAdminCloudShareTestDeps,
  handleTestCloudShareConnection,
} from "@/api/admin-cloudshare";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export async function POST() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await handleTestCloudShareConnection(buildAdminCloudShareTestDeps(services), {
    customerId: session.customerId,
  });
  return NextResponse.json(response.body, { status: response.status });
}
