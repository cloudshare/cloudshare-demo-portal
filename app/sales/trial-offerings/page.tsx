import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesWorkspace } from "@/web/sales-workspace";
import { getExpiredPortalLoginPath } from "@/auth/portal-return-target";

export default async function SalesTrialOfferingsPage() {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) {
    redirect(getExpiredPortalLoginPath("/sales") ?? "/login");
  }
  if (session.role !== "admin") {
    redirect(getPortalHomePath(session));
  }
  if (session.workspace !== "sales") {
    redirect("/admin");
  }
  return <SalesWorkspace email={session.email} initialRoute={{ tab: "trial-offerings" }} />;
}
