import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPortalSessionServices } from "@/composition";
import {
  buildPortalSessionDeps,
  handleGetPortalSession,
  PORTAL_SESSION_COOKIE,
} from "@/api/portal-auth";

export async function GET() {
  const services = getPortalSessionServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const response = await handleGetPortalSession(
    buildPortalSessionDeps(services),
    { sessionId },
  );
  return NextResponse.json(response.body, { status: response.status });
}
