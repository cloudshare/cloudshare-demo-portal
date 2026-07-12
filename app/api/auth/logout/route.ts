import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPortalLogoutServices, getPortalSessionServices } from "@/composition";
import {
  buildPortalLogoutDeps,
  handlePortalLogout,
  PORTAL_SESSION_COOKIE,
} from "@/api/portal-auth";

export async function POST() {
  const sessionServices = getPortalSessionServices();
  await sessionServices.ensurePortalSeeded();
  const services = getPortalLogoutServices();

  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  await handlePortalLogout(buildPortalLogoutDeps(services), { sessionId });

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
