import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Fast guard for the admin UI and admin API. A real admin session is still
 * verified server-side against the DB-backed session store inside each route;
 * middleware only short-circuits obvious anonymous requests before they hit the
 * heavier server path.
 */
const PORTAL_SESSION_COOKIE = "portal_session";

export function middleware(request: NextRequest): NextResponse {
  const sessionCookie = request.cookies.get(PORTAL_SESSION_COOKIE)?.value;
  if (sessionCookie) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
