import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Guards the admin UI (/admin) and admin API (/api/admin/*) behind a shared
 * secret bearer token (ADMIN_TOKEN env var). Returns 401 for missing/wrong
 * credentials rather than exposing candidate audit data to unauthenticated callers.
 *
 * Candidates never reach these paths — the portal routes them to /candidate/*.
 */
export function middleware(request: NextRequest): NextResponse {
  const adminToken = process.env.ADMIN_TOKEN;

  // Belt-and-suspenders: if ADMIN_TOKEN is missing at runtime, block all admin
  // access rather than silently opening up (fail closed).
  if (!adminToken) {
    return NextResponse.json({ error: "admin access not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  // Constant-time string comparison to resist timing attacks.
  if (!timingSafeEqual(token, adminToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

/** Constant-time equality check for short secrets (avoids early-exit timing leak). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
