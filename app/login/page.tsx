import React from "react";
import { LoginForm } from "./login-form";
import { getServices } from "@/composition";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

interface LoginPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const rawError = params.error;
  const initialError = typeof rawError === "string" ? rawError : null;
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (session) {
    redirect(getPortalHomePath(session));
  }
  const initialEmail = services.config.seed.heliosAdmin?.email ?? "";

  return <LoginForm initialError={initialError} initialEmail={initialEmail} />;
}
