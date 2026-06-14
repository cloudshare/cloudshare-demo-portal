import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServices } from "@/composition";
import {
  handlePortalLogout,
  PORTAL_SESSION_COOKIE,
} from "@/api/portal-auth";

export async function POST() {
  const services = getServices();
  await services.ensurePortalSeeded();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  await handlePortalLogout(
    { portalAuth: services.portalAuth },
    { sessionId },
  );

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(PORTAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return response;
}
