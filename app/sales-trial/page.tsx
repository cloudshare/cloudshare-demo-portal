import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesTrialHome } from "@/web/sales-trial-home";
import { getExpiredPortalLoginPath } from "@/auth/portal-return-target";

export default async function SalesTrialPage() {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);

  if (!session) {
    redirect(getExpiredPortalLoginPath("/sales-trial") ?? "/sales-trial/login");
  }
  if (session.role !== "sales_trial_participant") {
    redirect(getPortalHomePath(session));
  }

  return <SalesTrialHome email={session.email} firstName={session.firstName ?? null} />;
}
