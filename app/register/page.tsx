import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { RegisterForm } from "./register-form";

export default async function RegisterPage() {
  const services = getServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (session) {
    redirect(getPortalHomePath(session));
  }

  return <RegisterForm />;
}
