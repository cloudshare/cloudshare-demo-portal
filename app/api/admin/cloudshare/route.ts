import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import {
  buildAdminCloudShareConnectionDeps,
  handleGetCloudShareConnection,
  handleSaveCloudShareConnection,
} from "@/api/admin-cloudshare";
import { getPortalAdminSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

async function getAdminContext() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalAdminSession(services, sessionId);
  if (!session) {
    return { services, session: null };
  }
  return { services, session };
}

export async function GET() {
  const { services, session } = await getAdminContext();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await handleGetCloudShareConnection(
    buildAdminCloudShareConnectionDeps(services),
    { customerId: session.customerId },
  );
  return NextResponse.json(response.body, { status: response.status });
}

export async function PUT(request: Request) {
  const { services, session } = await getAdminContext();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const response = await handleSaveCloudShareConnection(
    buildAdminCloudShareConnectionDeps(services),
    { customerId: session.customerId, body },
  );
  return NextResponse.json(response.body, { status: response.status });
}
