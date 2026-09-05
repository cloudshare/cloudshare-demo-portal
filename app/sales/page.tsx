import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalHomePath, getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesWorkspace } from "@/web/sales-workspace";
import { parseSalesWorkspaceRouteState } from "@/web/sales-shell-route";
import { getExpiredPortalLoginPath, getSafePortalTargetFromSearchParams } from "@/auth/portal-return-target";

type SalesPageProps = { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const services = getPortalSessionServices();
  const sessionId = (await cookies()).get(PORTAL_SESSION_COOKIE)?.value;
  const session = await getPortalSession(services, sessionId);
  const params = await searchParams ?? {};
  if (!session) redirect(getExpiredPortalLoginPath(getSafePortalTargetFromSearchParams("/sales", params)) ?? "/login");
  if (session.role !== "admin") redirect(getPortalHomePath(session));
  if (session.workspace !== "sales") redirect("/admin");
  const routeState = parseSalesWorkspaceRouteState(params);
  return <SalesWorkspace key={`${routeState.tab}:${routeState.itemView ?? ""}:${routeState.sessionView ?? ""}:${routeState.sessionId ?? ""}:${routeState.sessionStatus ?? ""}:${routeState.participantsOpen ? "participants" : ""}:${routeState.itemId ?? ""}:${routeState.correlationId ?? ""}:${routeState.source ?? ""}:${routeState.subjectId ?? ""}`} email={session.email} initialRoute={routeState} />;
}
