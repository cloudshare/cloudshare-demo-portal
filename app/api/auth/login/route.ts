import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import { handlePortalLogin, PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export async function POST(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const response = await handlePortalLogin(
    { portalAuth: services.portalAuth },
    { body },
  );
  const nextResponse = NextResponse.json(response.body, { status: response.status });
  if (response.session) {
    nextResponse.cookies.set(PORTAL_SESSION_COOKIE, response.session.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return nextResponse;
}
