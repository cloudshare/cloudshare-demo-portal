import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesTrialOfferingsAdmin } from "@/web/sales-trial-offerings-admin";

export default async function SalesTrialOfferingsPage() {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) {
    redirect("/login");
  }
  if (session.role !== "admin") {
    redirect(getPortalHomePath(session));
  }
  if (session.workspace !== "sales") {
    redirect("/admin");
  }
  return <SalesTrialOfferingsAdmin email={session.email} />;
}
