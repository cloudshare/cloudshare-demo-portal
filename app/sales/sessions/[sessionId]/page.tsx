import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSessionServices } from "@/composition";
import { getPortalSession } from "@/auth/portal-session";
import { PORTAL_SESSION_COOKIE } from "@/api/portal-auth";
import { SalesSessionWorkspace } from "@/web/sales-session-workspace";
import { SalesWorkspaceChrome } from "@/web/sales-workspace-chrome";

type Props = { readonly params: Promise<{ sessionId: string }>; readonly searchParams: Promise<Record<string, string | string[] | undefined>> };
export default async function SalesSessionPage({ params, searchParams }: Props) {
  const services = getPortalSessionServices();
  const session = await getPortalSession(services, (await cookies()).get(PORTAL_SESSION_COOKIE)?.value);
  if (!session) redirect("/login");
  if (session.role !== "admin" || session.workspace !== "sales") redirect("/admin");
  const query = await searchParams;
  const requestedArea = singleSearchParam(query.area);
  const requestedQueueHref = singleSearchParam(query.from);
  const area = requestedArea === "activity" || requestedArea === "details" ? requestedArea : "participants";
  const queueHref = requestedQueueHref?.startsWith("/sales?") ? requestedQueueHref : "/sales?tab=sessions";
  return <SalesWorkspaceChrome email={session.email} activeTab="sessions"><SalesSessionWorkspace sessionId={(await params).sessionId} area={area} queueHref={queueHref} /></SalesWorkspaceChrome>;
}

function singleSearchParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
