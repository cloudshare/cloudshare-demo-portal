import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesWorkspace } from "@/web/sales-workspace";
import { parseSalesWorkspaceRouteState } from "@/web/sales-shell-route";

type SalesPageProps = { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/candidate");
  if (session.workspace !== "sales") redirect("/admin");
  const params = await searchParams ?? {};
  const routeState = parseSalesWorkspaceRouteState(params);
  return <SalesWorkspace key={`${routeState.tab}:${routeState.itemView ?? ""}:${routeState.itemId ?? ""}:${routeState.accountId ?? ""}:${routeState.opportunityId ?? ""}:${routeState.correlationId ?? ""}`} email={session.email} initialRoute={routeState} />;
}
