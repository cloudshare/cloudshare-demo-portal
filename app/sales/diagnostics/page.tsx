import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";

export default async function SalesDiagnosticsPage() {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/candidate");
  if (session.workspace !== "sales") redirect("/admin");

  redirect("/sales?tab=support");
}
