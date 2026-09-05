import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesTrialLoginForm } from "./login-form";
import { getSafePortalReturnTarget } from "@/auth/portal-return-target";

interface SalesTrialLoginPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SalesTrialLoginPage({
  searchParams,
}: SalesTrialLoginPageProps) {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (session) {
    redirect(getPortalHomePath(session));
  }

  const params = (await searchParams) ?? {};
  const rawError = params.error;
  const initialError = typeof rawError === "string" ? rawError : null;
  const returnTo = getSafePortalReturnTarget(
    typeof params.returnTo === "string" ? params.returnTo : null,
  );

  return <SalesTrialLoginForm initialEmail="" initialError={initialError} returnTo={returnTo} />;
}
