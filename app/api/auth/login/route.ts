import { NextResponse } from "next/server";
import { getServices } from "@/composition";
import {
  buildPortalLoginDeps,
  handlePortalLogin,
  PORTAL_SESSION_COOKIE,
} from "@/api/portal-auth";
import { DEFAULT_PORTAL_SESSION_TTL_MS } from "@/auth";

export async function POST(request: Request) {
  const services = getServices();
  await services.ensurePortalSeeded();

  const contentType = request.headers.get("content-type") ?? "";
  const expectsJson = contentType.includes("application/json");

  let body: unknown;
  if (expectsJson) {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  } else {
    const formData = await request.formData();
    body = {
      email: formData.get("email"),
      password: formData.get("password"),
    };
  }

  const response = await handlePortalLogin(
    buildPortalLoginDeps(services),
    { body },
  );

  if (!expectsJson) {
    const redirectUrl = new URL(
      response.session
        ? response.session.role === "admin"
          ? "/admin"
          : "/candidate"
        : "/login",
      request.url,
    );
    if (!response.session) {
      const error =
        typeof response.body.error === "string" ? response.body.error : "Login failed";
      redirectUrl.searchParams.set("error", error);
    }

    const nextResponse = NextResponse.redirect(redirectUrl, { status: 303 });
    if (response.session) {
      nextResponse.cookies.set(PORTAL_SESSION_COOKIE, response.session.sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: Math.floor(DEFAULT_PORTAL_SESSION_TTL_MS / 1000),
      });
    }
    return nextResponse;
  }

  const nextResponse = NextResponse.json(response.body, { status: response.status });
  if (response.session) {
    nextResponse.cookies.set(PORTAL_SESSION_COOKIE, response.session.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: Math.floor(DEFAULT_PORTAL_SESSION_TTL_MS / 1000),
    });
  }
  return nextResponse;
}
