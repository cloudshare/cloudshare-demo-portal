import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import { handleGetPortalSession, PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export async function GET() {
  const services = getServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const response = await handleGetPortalSession(
    { portalAuth: services.portalAuth },
    { sessionId },
  );
  return NextResponse.json(response.body, { status: response.status });
}
