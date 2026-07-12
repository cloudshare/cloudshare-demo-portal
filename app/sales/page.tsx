import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesWorkspace } from "@/web/sales-workspace";

export default async function SalesPage() {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/candidate");
  if (session.workspace !== "sales") redirect("/admin");
  return <SalesWorkspace email={session.email} />;
}
